//! Captura do áudio de um processo (ou do sistema menos um processo) com o
//! process loopback do WASAPI.
//!
//! - Modo por eventos: o WASAPI acorda a thread quando há dados, sem polling.
//! - Buffer de 100 ms: em captura compartilhada, um buffer maior não adiciona
//!   latência; só dá folga contra perdas quando a thread atrasa.
//! - Pacotes marcados como silenciosos chegam ao sink como zeros.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tracing::{info, warn};
use wasapi::{AudioCaptureClient, AudioClient, Direction, Handle, StreamMode, WaveFormat};

use crate::error::AppError;
use crate::media::{
    audio::AudioTarget, spawn_capture, AudioSink, CaptureHandle, EndReason, OnEnd, SinkStatus,
    AUDIO_CHANNELS, AUDIO_SAMPLE_RATE,
};

const BYTES_PER_SAMPLE: usize = 4; // f32
const BYTES_PER_FRAME: usize = BYTES_PER_SAMPLE * AUDIO_CHANNELS;
const BUFFER_DURATION_HNS: i64 = 1_000_000; // 100 ms, em unidades de 100 ns
const EVENT_TIMEOUT_MS: u32 = 100;

/// Quantas esperas seguidas podem falhar bem antes do timeout até a captura ser
/// dada como quebrada. Ver o comentário em [`run`].
const MAX_FAST_WAIT_FAILURES: u32 = 10;

/// Inicia a captura de áudio por process loopback do WASAPI, entregando as
/// amostras (f32 intercaladas, estéreo, 48 kHz) ao `sink`.
///
/// # Bloqueia
///
/// Espera a captura inicializar. Só chamar dentro de `spawn_blocking`.
pub fn spawn_audio_capture(
    target: AudioTarget,
    mut sink: impl AudioSink,
    on_end: OnEnd,
) -> Result<CaptureHandle, AppError> {
    spawn_capture("audio-capture", on_end, move |mut ctx| {
        let stream = match open_stream(target) {
            Ok(stream) => stream,
            Err(e) => {
                let message = e.to_string();
                ctx.ready.fail(e);
                return EndReason::Error(message);
            }
        };

        ctx.ready.ok();
        info!(?target, "captura de áudio iniciada");

        let reason = run(&stream, &mut sink, &ctx.stop);
        info!(?reason, "captura de áudio encerrada");
        reason
    })
}

/// Os objetos do WASAPI de uma captura aberta. Só existem na thread que os criou.
struct Stream {
    client: AudioClient,
    capture: AudioCaptureClient,
    event: Handle,
}

/// Ativa o loopback, configura o formato e inicia o stream do WASAPI.
///
/// Só pode ser chamada na thread de captura: inicializa o COM nela.
fn open_stream(target: AudioTarget) -> Result<Stream, AppError> {
    // O COM precisa ser inicializado em cada thread que usa o WASAPI.
    let _ = wasapi::initialize_mta();

    // A crate chama de `include_tree`: true inclui só o processo; false captura tudo menos ele.
    let (process_id, include_tree) = match target {
        AudioTarget::Process(pid) => (pid, true),
        AudioTarget::SystemExcept(pid) => (pid, false),
    };

    let mut client = AudioClient::new_application_loopback_client(process_id, include_tree)
        .map_err(|e| {
            AppError::AudioCapture(format!("ativar o loopback do processo {process_id}: {e}"))
        })?;

    // O process loopback não informa um formato próprio: quem define somos nós.
    let format = WaveFormat::new(
        32,
        32,
        wasapi::SampleType::Float,
        AUDIO_SAMPLE_RATE as usize,
        AUDIO_CHANNELS,
        None,
    );

    let mode = StreamMode::EventsShared {
        autoconvert: true,
        buffer_duration_hns: BUFFER_DURATION_HNS,
    };
    client
        .initialize_client(&format, Direction::Capture, mode, None)
        .map_err(|e| AppError::AudioCapture(format!("inicializar o cliente: {e}")))?;

    let event = client
        .set_get_eventhandle()
        .map_err(|e| AppError::AudioCapture(format!("criar o evento: {e}")))?;
    let capture = client
        .get_audiocaptureclient()
        .map_err(|e| AppError::AudioCapture(format!("obter o cliente de captura: {e}")))?;
    client
        .start_stream()
        .map_err(|e| AppError::AudioCapture(format!("iniciar o stream: {e}")))?;

    Ok(Stream {
        client,
        capture,
        event,
    })
}

/// Laço de leitura: roda até o `stop`, o sink pedir para parar ou a leitura falhar.
fn run(stream: &Stream, sink: &mut impl AudioSink, stop: &AtomicBool) -> EndReason {
    // Reaproveitados entre pacotes: nenhuma alocação por pacote.
    let mut bytes: Vec<u8> = Vec::new();
    let mut samples: Vec<f32> = Vec::new();
    let mut fast_failures = 0;

    while !stop.load(Ordering::Acquire) {
        // Espera o WASAPI avisar que há dados. O timeout só serve para re-checar o `stop`.
        //
        // A crate `wasapi` devolve o mesmo erro (`EventTimeout`) para timeout e para falha
        // real da espera, então não dá para distingui-los pelo erro. Um timeout de verdade
        // leva o tempo todo; uma falha volta na hora. Muitas falhas rápidas seguidas
        // significam que o handle quebrou, e sem esta checagem o laço giraria sem parar.
        let waited_since = Instant::now();
        if stream.event.wait_for_event(EVENT_TIMEOUT_MS).is_err() {
            if waited_since.elapsed() < Duration::from_millis(u64::from(EVENT_TIMEOUT_MS / 2)) {
                fast_failures += 1;
                if fast_failures >= MAX_FAST_WAIT_FAILURES {
                    return end_with_error(stream, "a espera pelo evento de áudio falhou".into());
                }
            } else {
                fast_failures = 0;
            }
            continue;
        }
        fast_failures = 0;
        // Um aviso pode corresponder a vários pacotes: lê até esvaziar.
        loop {
            let frames = match stream.capture.get_next_packet_size() {
                Ok(Some(frames)) if frames > 0 => frames as usize,
                Ok(_) => break,
                Err(e) => return end_with_error(stream, format!("ler o tamanho do pacote: {e}")),
            };

            bytes.resize(frames * BYTES_PER_FRAME, 0);

            let (read, info) = match stream.capture.read_from_device(&mut bytes) {
                Ok(result) => result,
                Err(e) => return end_with_error(stream, format!("ler o pacote: {e}")),
            };
            let len = read as usize * BYTES_PER_FRAME;

            if info.flags.data_discontinuity {
                warn!("descontinuidade na captura de áudio: amostras foram perdidas");
            }

            samples.clear();
            if info.flags.silent {
                // A documentação do WASAPI manda ignorar o conteúdo de pacotes silenciosos.
                samples.resize(len / BYTES_PER_SAMPLE, 0.0);
            } else {
                samples.extend(
                    bytes[..len]
                        .as_chunks::<BYTES_PER_SAMPLE>()
                        .0
                        .iter()
                        .map(|b| f32::from_le_bytes(*b)),
                );
            }

            if let SinkStatus::Stop = sink.push(&samples) {
                let _ = stream.client.stop_stream();
                return EndReason::Stopped;
            }
        }
    }
    let _ = stream.client.stop_stream();
    EndReason::Stopped
}

/// Para o stream e devolve o erro como motivo do fim da captura.
fn end_with_error(stream: &Stream, message: String) -> EndReason {
    let _ = stream.client.stop_stream();
    EndReason::Error(message)
}
