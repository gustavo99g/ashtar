//! As miniaturas no Windows: uma captura do WGC por fonte, no mesmo dispositivo, com a redução para
//! BGRA na GPU e a leitura para a memória (ADR 0019).

use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

use super::convert::{Converter, OutputFormat};
use super::gpu::GpuDevice;
use super::readback::Readback;
use super::wgc::{self, WgcCapture};
use crate::error::AppError;
use crate::media::capture::{spawn_capture, EndReason};
use crate::media::sources::SourceRef;
use crate::media::thumbnails::{encode_jpeg, OnThumbnail, THUMB_FPS, THUMB_SIZE};
use crate::media::{CaptureHandle, SinkStatus};

/// Uma fonte com miniatura.
struct Card {
    capture: WgcCapture,
    converter: Converter,
}

/// Ver o módulo. As fontes que não abrem (fechadas, ou sem permissão) ficam sem miniatura.
///
/// # Bloqueia
///
/// Até o dispositivo da GPU abrir. Só chamar dentro de `spawn_blocking`.
pub fn spawn_thumbnails(
    sources: Vec<SourceRef>,
    updates: Receiver<Vec<SourceRef>>,
    mut on_thumbnail: OnThumbnail,
) -> Result<CaptureHandle, AppError> {
    spawn_capture("ashtar-thumbnails", Box::new(|_| {}), move |mut ctx| {
        wgc::init_thread();
        let (gpu, readback) = match GpuDevice::new()
            .and_then(|gpu| Readback::new(&gpu, THUMB_SIZE, OutputFormat::Bgra).map(|r| (gpu, r)))
        {
            Ok(opened) => opened,
            Err(error) => {
                ctx.ready.fail(error);
                return EndReason::Stopped;
            }
        };
        ctx.ready.ok();

        let mut cards: HashMap<SourceRef, Card> = HashMap::new();
        reconcile(&gpu, &mut cards, &sources);
        let interval = Duration::from_secs(1) / THUMB_FPS;
        let mut next = Instant::now();
        while !ctx.stop.load(Ordering::Acquire) {
            if let Some(latest) = updates.try_iter().last() {
                reconcile(&gpu, &mut cards, &latest);
            }
            cards.retain(|_, card| !card.capture.is_closed());
            for (source, card) in &mut cards {
                match thumbnail(&gpu, &readback, card) {
                    Ok(Some(jpeg)) => {
                        if let SinkStatus::Stop = on_thumbnail(*source, &jpeg) {
                            return EndReason::Stopped;
                        }
                    }
                    Ok(None) => {}
                    Err(error) => {
                        tracing::debug!(target: "media", %error, "miniatura falhou");
                    }
                }
            }
            next += interval;
            let now = Instant::now();
            if next < now {
                next = now + interval;
            }
            std::thread::sleep(next - now);
        }
        EndReason::Stopped
    })
}

/// Deixa em `cards` exatamente as fontes de `sources`, sem recomeçar as que continuam.
fn reconcile(gpu: &GpuDevice, cards: &mut HashMap<SourceRef, Card>, sources: &[SourceRef]) {
    cards.retain(|source, _| sources.contains(source));
    for source in sources {
        if cards.contains_key(source) {
            continue;
        }
        let opened = WgcCapture::new(gpu, *source, false).and_then(|capture| {
            let converter = Converter::new(
                gpu,
                capture.size(),
                THUMB_SIZE,
                OutputFormat::Bgra,
                THUMB_FPS,
            )?;
            Ok(Card { capture, converter })
        });
        match opened {
            Ok(card) => {
                cards.insert(*source, card);
            }
            Err(error) => {
                tracing::debug!(target: "media", ?source, %error, "sem miniatura para a fonte");
            }
        }
    }
}

/// A miniatura nova de `card`, se a imagem mudou.
fn thumbnail(
    gpu: &GpuDevice,
    readback: &Readback,
    card: &mut Card,
) -> Result<Option<Vec<u8>>, AppError> {
    if card.capture.size() != card.converter.input_size() {
        card.converter = Converter::new(
            gpu,
            card.capture.size(),
            THUMB_SIZE,
            OutputFormat::Bgra,
            THUMB_FPS,
        )?;
    }
    let converter = &card.converter;
    if card
        .capture
        .latest(|frame| converter.store(frame))?
        .is_none()
    {
        return Ok(None);
    }
    let texture = card.converter.convert(0)?;
    let bgra = readback.read(gpu, texture)?;
    encode_jpeg(&bgra, THUMB_SIZE.0, THUMB_SIZE.1).map(Some)
}
