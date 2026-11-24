//! O laço do vídeo da transmissão no Windows (ADR 0018).
//!
//! Uma thread só, dona de tudo que é da GPU: a captura do WGC, o conversor, o encoder e (no plano
//! B) a leitura para a memória. A cada volta ela:
//!
//! 1. trata os comandos que chegaram ([`VideoCommand`]);
//! 2. confere se a janela fechou;
//! 3. recolhe o que o encoder terminou e entrega ao destino;
//! 4. no horário do próximo frame, pega a imagem mais nova do WGC (ou reaproveita a última, se a
//!    tela está parada há [`RESEND_AFTER`]) e manda para o encoder.
//!
//! O encoder só recebe um frame quando pediu entrada e quando há textura livre no anel do
//! conversor (no máximo `RING - 1` no encoder ao mesmo tempo). Fora disso, o frame é descartado e
//! contado: atrasar o frame seria pior do que pular um.
//!
//! O relógio dos frames é o do WGC (`SystemRelativeTime`, em 100 ns). Na saída ele vira
//! microssegundos desde 1970, que é o que o libwebrtc usa.

use std::sync::atomic::Ordering;
use std::sync::mpsc::Receiver;
use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use windows::Win32::Media::MediaFoundation::{MFStartup, MFSTARTUP_FULL, MF_VERSION};
use windows::Win32::Media::{timeBeginPeriod, timeEndPeriod};

use super::convert::{Converter, OutputFormat, RING};

/// Quanto tempo o teste do encoder da placa espera a primeira imagem ([`probe`]).
const PROBE_TIMEOUT: Duration = Duration::from_millis(1500);
/// Quanto tempo o encoder da placa pode ficar com imagens sem devolver nenhuma antes de o log
/// avisar.
const HARDWARE_STALL: Duration = Duration::from_secs(2);
use super::amf::AmfEncoder;
use super::gpu::GpuDevice;
use super::hardware::HardwareEncoder;
use super::mf_encoder::{EncoderSettings, MfEncoder};
use super::readback::Readback;
use super::wgc::{self, WgcCapture};
use crate::error::AppError;
use crate::media::bitrate::BitrateController;
use crate::media::capture::{spawn_capture, EndReason};
use crate::media::encoded::{EncodedFrame, PacketSink, RawFrame, VideoPacket};
use crate::media::encoder_memory::{order, EncoderMemory, HardwarePath};
use crate::media::sources::SourceRef;
use crate::media::video::{
    output_size, EncoderKind, EncoderPreference, ResizeSettle, VideoCommand, VideoConfig,
    VideoControl, VideoFormat, VideoStats, RESEND_AFTER,
};
use crate::media::{CaptureHandle, OnEnd, SinkStatus};

/// Quanto a thread dorme, no máximo, entre uma volta e outra: o encoder entrega a saída a
/// qualquer momento, e ela não deve esperar o próximo frame para sair.
const MAX_NAP: Duration = Duration::from_millis(2);

/// Ver o módulo. Os parâmetros são os de [`crate::media::video::spawn_video`], mais
/// `force_software` (o plano B mesmo com encoder de hardware).
///
/// # Bloqueia
///
/// Até a captura, a conversão e o encoder começarem. Só chamar dentro de `spawn_blocking`.
pub fn spawn_video(
    config: VideoConfig,
    force_software: bool,
    mut sink: impl PacketSink,
    on_end: OnEnd,
) -> Result<(CaptureHandle, VideoControl, VideoStats), AppError> {
    let (control, commands) = VideoControl::new();
    let stats = VideoStats::new(
        EncoderKind::Software,
        String::new(),
        config.format.bitrate_bps,
    );
    let thread_stats = stats.clone();

    let handle = spawn_capture("ashtar-video", on_end, move |mut ctx| {
        let _runtime = match Runtime::start() {
            Ok(runtime) => runtime,
            Err(error) => {
                ctx.ready.fail(error);
                return EndReason::Stopped;
            }
        };
        let mut pipeline = match Pipeline::new(config, force_software, thread_stats) {
            Ok(pipeline) => pipeline,
            Err(error) => {
                ctx.ready.fail(error);
                return EndReason::Stopped;
            }
        };
        ctx.ready.ok();

        let reason = match pipeline.run(&commands, &mut sink, &|| ctx.stop.load(Ordering::Acquire))
        {
            Ok(reason) => reason,
            Err(error) => {
                tracing::error!(target: "media", %error, "o vídeo da transmissão parou com erro");
                EndReason::Error(error.to_string())
            }
        };
        // A sessão fica sabendo antes de a captura e o encoder serem soltos: no fim de uma
        // partida do LoL, soltar a captura da janela que fechou travou a thread, e a transmissão
        // ficou parada na última imagem em vez de voltar para o cliente.
        ctx.report(reason.clone());
        drop(pipeline);
        tracing::info!(target: "media", "vídeo da transmissão liberado");
        reason
    })?;

    Ok((handle, control, stats))
}

/// O que a thread precisa ligado enquanto vive: o WinRT (para o WGC), o Media Foundation e o
/// `sleep` com resolução de 1 ms (o padrão do Windows é ~15,6 ms, longe dos 16,7 ms de 60 fps).
/// Desliga o `sleep` no `Drop`.
///
/// O Media Foundation é iniciado **uma vez por processo e nunca desligado**. Com um
/// `MFShutdown` ao fim de cada transmissão, a transmissão seguinte no mesmo processo derrubava o
/// app (`STATUS_ACCESS_VIOLATION` ao criar o encoder da AMD, reproduzido ao repetir a transmissão
/// em sequência); sem ele, 4 seguidas passam. O custo é o Media Foundation ficar carregado.
struct Runtime;

/// O resultado do `MFStartup`, dado uma vez só.
static MEDIA_FOUNDATION: OnceLock<Result<(), String>> = OnceLock::new();

impl Runtime {
    fn start() -> Result<Self, AppError> {
        wgc::init_thread();
        let started = MEDIA_FOUNDATION.get_or_init(|| {
            // SAFETY: sem pré-condições; roda uma vez, e o `MFShutdown` fica de fora de propósito
            // (ver o `Runtime`).
            unsafe { MFStartup(MF_VERSION, MFSTARTUP_FULL) }
                .map_err(|error| format!("{} ({:#010x})", error.message(), error.code().0))
        });
        if let Err(message) = started {
            return Err(AppError::VideoCapture(format!("MFStartup: {message}")));
        }
        // SAFETY: sem pré-condições; casado com o `timeEndPeriod` do `Drop`.
        unsafe { timeBeginPeriod(1) };
        Ok(Self)
    }
}

impl Drop for Runtime {
    fn drop(&mut self) {
        // SAFETY: ver `Runtime::start`.
        unsafe { timeEndPeriod(1) };
    }
}

/// Para onde vai a imagem convertida.
enum Output {
    Hardware {
        /// Numa caixa: o encoder é bem maior que o plano B (o `large_enum_variant` do clippy).
        encoder: Box<HardwareEncoder>,
        bitrate: BitrateController,
        /// Frames entregues ao encoder que ainda não saíram.
        in_flight: usize,
        /// Quando saiu a última imagem codificada (ou quando o encoder foi criado).
        last_output: Instant,
    },
    /// Plano B: a imagem volta para a memória e o libwebrtc codifica.
    Software { readback: Readback },
}

struct Pipeline {
    gpu: GpuDevice,
    capture: WgcCapture,
    converter: Converter,
    output: Output,
    stats: VideoStats,
    format: VideoFormat,
    /// O último alvo da estimativa de banda da LiveKit. O encoder segue o menor entre ele e o
    /// bitrate do preset ([`Pipeline::target_bps`]): a trilha anuncia o teto do preset mais caro.
    network_bps: u32,
    /// A trilha foi publicada para o plano B (vídeo cru), não para o encoder da placa. O tipo da
    /// trilha não muda no meio da transmissão, então um encoder refeito fica no mesmo caminho:
    /// pacotes do encoder da placa numa trilha crua deixavam a tela preta para quem assistia.
    software_track: bool,
    cursor: bool,
    paused: bool,
    /// A entrada do conversor tem uma imagem de verdade (para reenviar).
    has_image: bool,
    keyframe_pending: bool,
    /// A próxima textura do anel.
    slot: usize,
    last_sent: Option<Instant>,
    /// A janela mudou de tamanho: o encoder é refeito no tamanho novo quando ela parar.
    resize: ResizeSettle,
}

impl Pipeline {
    fn new(config: VideoConfig, force_software: bool, stats: VideoStats) -> Result<Self, AppError> {
        let gpu = GpuDevice::new()?;
        stats.set_adapter(gpu.adapter_name().to_string());
        let capture = WgcCapture::new(&gpu, config.source, config.cursor)?;
        capture.allow_full_rate();
        let (converter, output) = build_output(
            &gpu,
            &capture,
            config.format,
            config.format.bitrate_bps,
            force_software,
            &stats,
        )?;
        let software_track = matches!(output, Output::Software { .. });
        Ok(Self {
            gpu,
            capture,
            converter,
            output,
            stats,
            format: config.format,
            network_bps: u32::MAX,
            software_track,
            cursor: config.cursor,
            paused: false,
            has_image: false,
            keyframe_pending: true,
            slot: 0,
            last_sent: None,
            resize: ResizeSettle::default(),
        })
    }

    fn run(
        &mut self,
        commands: &Receiver<VideoCommand>,
        sink: &mut impl PacketSink,
        stopped: &dyn Fn() -> bool,
    ) -> Result<EndReason, AppError> {
        let mut next_frame = Instant::now();
        loop {
            if stopped() {
                return Ok(EndReason::Stopped);
            }
            // Sem ninguém com o controle (canal desconectado), a transmissão segue até o `stop`.
            while let Ok(command) = commands.try_recv() {
                self.handle(command)?;
            }
            if self.capture.is_closed() {
                tracing::info!(target: "media", "a janela da transmissão fechou");
                return Ok(EndReason::SourceClosed);
            }
            if let SinkStatus::Stop = self.collect(sink)? {
                return Ok(EndReason::Stopped);
            }

            let now = Instant::now();
            if now >= next_frame {
                if let SinkStatus::Stop = self.produce(sink, now)? {
                    return Ok(EndReason::Stopped);
                }
                next_frame += self.format.frame_interval();
                if next_frame < now {
                    // Ficou para trás (a máquina travou um pouco): recomeça daqui, sem rajada.
                    next_frame = now + self.format.frame_interval();
                }
            }
            std::thread::sleep(
                next_frame
                    .saturating_duration_since(Instant::now())
                    .min(MAX_NAP),
            );
        }
    }

    fn handle(&mut self, command: VideoCommand) -> Result<(), AppError> {
        let now = Instant::now();
        match command {
            VideoCommand::Keyframe => {
                self.keyframe_pending = true;
                self.stats.keyframe_requested();
            }
            VideoCommand::TargetBitrate(bps) => {
                self.network_bps = bps.max(1);
                let target = self.target_bps();
                self.stats.set_target(target);
                if let Output::Hardware {
                    encoder, bitrate, ..
                } = &mut self.output
                {
                    if let Some(value) = bitrate.set_target(target, now) {
                        encoder.set_bitrate(value);
                    }
                }
            }
            VideoCommand::Format(format) => {
                format.validate()?;
                tracing::info!(
                    target: "media",
                    max = %format!("{}x{}", format.max_width, format.max_height),
                    fps = format.fps,
                    "preset novo"
                );
                self.format = format;
                self.rebuild()?;
            }
            VideoCommand::Source(source) => {
                let label = match source {
                    SourceRef::Window(_) => "janela",
                    SourceRef::Monitor(_) => "tela",
                };
                // Uma fonte que sumiu entre o seletor e aqui não derruba a transmissão: fica a
                // que estava.
                match WgcCapture::new(&self.gpu, source, self.cursor) {
                    Ok(capture) => {
                        capture.allow_full_rate();
                        tracing::info!(target: "media", fonte = label, "fonte nova");
                        self.capture = capture;
                        self.rebuild()?;
                    }
                    Err(error) => {
                        tracing::warn!(target: "media", %error, "a fonte nova não abriu; segue a antiga");
                    }
                }
            }
            VideoCommand::Cursor(enabled) => {
                self.capture.set_cursor(enabled);
                self.cursor = enabled;
            }
            VideoCommand::Paused(paused) => {
                self.paused = paused;
                self.stats.set_paused(paused);
                if !paused {
                    self.keyframe_pending = true;
                }
            }
        }
        Ok(())
    }

    /// O que o encoder persegue: o menor entre a estimativa da LiveKit e o bitrate do preset.
    fn target_bps(&self) -> u32 {
        self.network_bps.min(self.format.bitrate_bps)
    }

    /// Recria a conversão e o encoder para o formato e a fonte atuais.
    fn rebuild(&mut self) -> Result<(), AppError> {
        let (converter, output) = build_output(
            &self.gpu,
            &self.capture,
            self.format,
            self.target_bps(),
            self.software_track,
            &self.stats,
        )?;
        if matches!(output, Output::Software { .. }) && !self.software_track {
            // A trilha espera o vídeo do encoder da placa: o plano B não tem como entrar nela.
            return Err(AppError::VideoCapture(
                "o encoder da placa não reabriu no tamanho novo".into(),
            ));
        }
        self.converter = converter;
        self.output = output;
        self.stats.set_target(self.target_bps());
        self.has_image = false;
        self.keyframe_pending = true;
        self.last_sent = None;
        self.resize.clear();
        Ok(())
    }

    /// Entrega ao destino tudo que o encoder terminou.
    fn collect(&mut self, sink: &mut impl PacketSink) -> Result<SinkStatus, AppError> {
        let Output::Hardware {
            encoder,
            bitrate,
            in_flight,
            last_output,
            ..
        } = &mut self.output
        else {
            return Ok(SinkStatus::Continue);
        };
        let (width, height) = self.converter.output_size();
        for output in encoder.poll()? {
            *in_flight = in_flight.saturating_sub(1);
            let now = Instant::now();
            *last_output = now;
            let age = age(output.time);
            self.stats.frame(output.data.len(), age, now);
            if let Some(value) = bitrate.on_frame(output.data.len(), now) {
                encoder.set_bitrate(value);
            }
            let packet = VideoPacket::Encoded(EncodedFrame {
                data: output.data,
                keyframe: output.keyframe,
                timestamp_us: unix_us_ago(age),
                width,
                height,
            });
            if let SinkStatus::Stop = sink.push(&packet) {
                return Ok(SinkStatus::Stop);
            }
        }
        Ok(SinkStatus::Continue)
    }

    /// O frame da vez: a imagem mais nova, ou a última de novo se a tela está parada.
    fn produce(
        &mut self,
        sink: &mut impl PacketSink,
        now: Instant,
    ) -> Result<SinkStatus, AppError> {
        if self.paused {
            return Ok(SinkStatus::Continue);
        }
        if self.capture.size() != self.converter.input_size() {
            // A janela mudou de tamanho: a entrada acompanha, a saída fica (com bordas).
            self.converter = Converter::new(
                &self.gpu,
                self.capture.size(),
                self.converter.output_size(),
                OutputFormat::Nv12,
                self.format.fps,
            )?;
            self.has_image = false;
            let wanted = output_size(self.capture.size(), self.format, !self.software_track);
            self.resize
                .changed(wanted, self.converter.output_size(), now);
        }
        if self.resize.due(now) {
            tracing::info!(
                target: "media",
                tamanho = %format!("{}x{}", self.capture.size().0, self.capture.size().1),
                "a janela mudou de tamanho: o encoder acompanha"
            );
            self.rebuild()?;
        }

        let converter = &self.converter;
        let time = match self.capture.latest(|frame| converter.store(frame))? {
            Some(time) => {
                self.has_image = true;
                time
            }
            None => {
                let stale = self
                    .last_sent
                    .is_some_and(|at| now.duration_since(at) >= RESEND_AFTER);
                if !self.has_image || !(stale || self.keyframe_pending) {
                    return Ok(SinkStatus::Continue);
                }
                wgc::now_100ns()
            }
        };

        match &mut self.output {
            Output::Hardware {
                encoder,
                in_flight,
                last_output,
                ..
            } => {
                if *in_flight > 0 && now.duration_since(*last_output) >= HARDWARE_STALL {
                    // Recebeu imagens e não devolveu nada (visto numa RX 7600, com o anel de 4
                    // texturas): vai para o log uma vez a cada período, para diagnosticar.
                    tracing::warn!(
                        target: "media",
                        encoder = encoder.name(),
                        em_voo = *in_flight,
                        pediu_entrada = encoder.wants_input(),
                        "o encoder de hardware não devolve imagens"
                    );
                    *last_output = now;
                }
                if !encoder.wants_input() || *in_flight >= RING - 1 {
                    self.stats.dropped();
                    return Ok(SinkStatus::Continue);
                }
                if self.keyframe_pending {
                    encoder.force_keyframe();
                    self.keyframe_pending = false;
                }
                let texture = self.converter.convert(self.slot)?;
                if encoder.submit(texture, time)? {
                    *in_flight += 1;
                } else {
                    self.stats.dropped();
                }
            }
            Output::Software { readback } => {
                let texture = self.converter.convert(self.slot)?;
                let nv12 = readback.read(&self.gpu, texture)?;
                let (width, height) = self.converter.output_size();
                let age = age(time);
                self.stats.frame(nv12.len(), age, now);
                self.keyframe_pending = false;
                let packet = VideoPacket::Raw(RawFrame {
                    nv12,
                    timestamp_us: unix_us_ago(age),
                    width,
                    height,
                });
                if let SinkStatus::Stop = sink.push(&packet) {
                    return Ok(SinkStatus::Stop);
                }
            }
        }
        self.slot = (self.slot + 1) % RING;
        self.last_sent = Some(now);
        Ok(SinkStatus::Continue)
    }
}

/// O conversor e o encoder (ou o plano B) para a fonte de `capture` no formato `format`.
fn build_output(
    gpu: &GpuDevice,
    capture: &WgcCapture,
    format: VideoFormat,
    target_bps: u32,
    force_software: bool,
    stats: &VideoStats,
) -> Result<(Converter, Output), AppError> {
    // Com o encoder da placa, o tamanho vai em múltiplos de 16 (ver `align_for_hardware`). Se a
    // placa não tiver encoder, o plano B recebe o mesmo tamanho, que também serve para ele.
    let size = output_size(capture.size(), format, !force_software);
    let converter = Converter::new(gpu, capture.size(), size, OutputFormat::Nv12, format.fps)?;
    stats.set_size(size.0, size.1);

    let hardware = if force_software {
        tracing::info!(target: "media", "plano B: pedido pelo ambiente ou pela trilha já publicada");
        None
    } else {
        let settings = EncoderSettings {
            width: size.0,
            height: size.1,
            fps: format.fps,
            bitrate_bps: target_bps,
        };
        let preference = EncoderPreference::from_env();
        if preference != EncoderPreference::Auto {
            tracing::info!(target: "media", ?preference, "encoder escolhido pelo ambiente (ASHTAR_ENCODER)");
        }
        let amd = gpu.is_amd();
        if preference == EncoderPreference::Amf && !amd {
            tracing::warn!(target: "media", placa = gpu.adapter_name(), "ASHTAR_ENCODER=amf numa placa que não é AMD");
        }
        let mut memory = EncoderMemory::open();
        let (adapter, driver) = (gpu.adapter_name(), gpu.driver());
        let mf_stalls_here = memory.mf_stalls(adapter, driver);
        if mf_stalls_here && preference == EncoderPreference::Auto {
            tracing::info!(target: "media", placa = adapter, driver, "o Media Foundation trava nesta placa com este driver: começa pelo AMF");
        }
        let mut mf_failed = false;
        let mut found = None;
        for candidate in order(preference, amd, mf_stalls_here) {
            match open_hardware(candidate, gpu, settings, &converter) {
                Some((encoder, in_flight)) => {
                    found = Some((candidate, encoder, in_flight));
                    break;
                }
                None => mf_failed |= candidate == HardwarePath::MediaFoundation,
            }
        }
        if preference == EncoderPreference::Auto && amd {
            match found.as_ref().map(|(candidate, ..)| *candidate) {
                Some(HardwarePath::Amf) if mf_failed => memory.remember(adapter, driver, true),
                Some(HardwarePath::MediaFoundation) => memory.remember(adapter, driver, false),
                _ => {}
            }
        }
        if found.is_none() {
            tracing::warn!(target: "media", "sem encoder de hardware que funcione: plano B");
        }
        found.map(|(_, encoder, in_flight)| (encoder, in_flight))
    };

    let output = match hardware {
        Some((encoder, in_flight)) => {
            tracing::info!(
                target: "media",
                encoder = encoder.name(),
                placa = gpu.adapter_name(),
                driver = gpu.driver(),
                tamanho = %format!("{}x{}", size.0, size.1),
                fps = format.fps,
                "encoder de hardware pronto"
            );
            stats.set_encoder(EncoderKind::Hardware(encoder.name().to_string()));
            Output::Hardware {
                encoder: Box::new(encoder),
                bitrate: BitrateController::new(target_bps, format.fps, Instant::now()),
                in_flight,
                last_output: Instant::now(),
            }
        }
        None => {
            stats.set_encoder(EncoderKind::Software);
            Output::Software {
                readback: Readback::new(gpu, size, OutputFormat::Nv12)?,
            }
        }
    };
    Ok((converter, output))
}

/// Abre o encoder do `candidate` e passa pelo [`probe`]. `None` (com o motivo no log) se ele não
/// abrir ou não devolver imagem.
fn open_hardware(
    candidate: HardwarePath,
    gpu: &GpuDevice,
    settings: EncoderSettings,
    converter: &Converter,
) -> Option<(HardwareEncoder, usize)> {
    let opened = match candidate {
        HardwarePath::MediaFoundation => MfEncoder::new(gpu, settings).map(HardwareEncoder::Mf),
        HardwarePath::Amf => AmfEncoder::new(gpu, settings).map(HardwareEncoder::Amf),
    };
    let mut encoder = match opened {
        Ok(encoder) => encoder,
        Err(error) => {
            tracing::warn!(target: "media", %error, ?candidate, "sem encoder de hardware");
            return None;
        }
    };
    match probe(&mut encoder, converter) {
        Ok(in_flight) => Some((encoder, in_flight)),
        Err(error) => {
            tracing::warn!(
                target: "media",
                %error,
                ?candidate,
                encoder = encoder.name(),
                placa = gpu.adapter_name(),
                "o encoder de hardware não passou no teste"
            );
            None
        }
    }
}

/// Antes de usar o encoder da placa, confere que ele devolve imagem: manda quadros pretos (a
/// entrada do conversor ainda está zerada) até sair o primeiro H.264, por no máximo
/// [`PROBE_TIMEOUT`]. Na RX 7600, o da AMD abria sem erro, aceitava um quadro e nunca devolvia
/// nada, e a transmissão ficava preta; agora esse caso cai no plano B antes de publicar.
///
/// Devolve quantos quadros do teste ainda estão no encoder (saem depois e são descartados por
/// quem assiste, que espera o keyframe do primeiro quadro de verdade).
fn probe(encoder: &mut HardwareEncoder, converter: &Converter) -> Result<usize, AppError> {
    let started = Instant::now();
    let mut submitted = 0usize;
    loop {
        let outputs = encoder.poll()?.len();
        if outputs > 0 {
            tracing::info!(
                target: "media",
                ms = started.elapsed().as_millis() as u64,
                quadros = submitted,
                "o encoder de hardware respondeu ao teste"
            );
            return Ok(submitted.saturating_sub(outputs));
        }
        if started.elapsed() >= PROBE_TIMEOUT {
            return Err(AppError::VideoCapture(format!(
                "nenhuma imagem em {} ms com {submitted} quadros entregues (pediu entrada: {})",
                PROBE_TIMEOUT.as_millis(),
                encoder.wants_input()
            )));
        }
        if encoder.wants_input() && submitted < RING - 1 {
            let texture = converter.convert(submitted)?;
            if encoder.submit(texture, wgc::now_100ns())? {
                submitted += 1;
            }
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}

/// Há quanto tempo o Windows compôs a imagem do horário `time` (100 ns, relógio do WGC).
fn age(time: i64) -> Duration {
    let ticks = (wgc::now_100ns() - time).max(0) as u64;
    Duration::from_nanos(ticks * 100)
}

/// Agora menos `age`, em microssegundos desde 1970.
fn unix_us_ago(age: Duration) -> i64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    now.saturating_sub(age).as_micros() as i64
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::media::encoded::{Fanout, H264File};
    use crate::media::platform::list_monitors;

    /// Conta os pacotes por tipo: (H.264, NV12, keyframes).
    #[derive(Clone, Default)]
    struct Counter(Arc<Mutex<(u32, u32, u32)>>);

    impl PacketSink for Counter {
        fn push(&mut self, packet: &VideoPacket) -> SinkStatus {
            let mut counts = self.0.lock().unwrap();
            match packet {
                VideoPacket::Encoded(frame) => {
                    counts.0 += 1;
                    counts.2 += u32::from(frame.keyframe);
                }
                VideoPacket::Raw(frame) => {
                    assert_eq!(frame.nv12.len() as u32, frame.width * frame.height * 3 / 2);
                    counts.1 += 1;
                }
            }
            SinkStatus::Continue
        }
    }

    fn primary() -> SourceRef {
        let monitor = list_monitors()
            .into_iter()
            .find(|m| m.info.is_primary)
            .expect("nenhuma tela principal");
        SourceRef::Monitor(monitor.id)
    }

    /// Transmite a tela principal por 5 s, em 1080p60, e devolve as contagens e os números.
    fn run(
        force_software: bool,
        file: Option<&Path>,
    ) -> ((u32, u32, u32), crate::media::video::StatsSnapshot) {
        let counter = Counter::default();
        let mut sink = Fanout::new().with(counter.clone());
        if let Some(path) = file {
            sink = sink.with(H264File::create(path).expect("arquivo"));
        }
        let config = VideoConfig {
            source: primary(),
            format: VideoFormat {
                max_width: 1920,
                max_height: 1080,
                fps: 60,
                bitrate_bps: 8_000_000,
            },
            cursor: true,
            software_encoder: false,
        };
        let (handle, control, stats) =
            spawn_video(config, force_software, sink, Box::new(|_| {})).expect("o vídeo começa");
        std::thread::sleep(Duration::from_secs(2));
        control.send(VideoCommand::Keyframe);
        std::thread::sleep(Duration::from_secs(3));
        let snapshot = stats.snapshot(Instant::now());
        handle.stop_and_join();
        let counts = *counter.0.lock().unwrap();
        println!("{counts:?} {snapshot:#?}");
        (counts, snapshot)
    }

    #[test]
    #[ignore = "precisa de uma área de trabalho real e de encoder de hardware"]
    fn transmite_a_tela_em_h264() {
        let path = std::env::temp_dir().join("ashtar-pipeline.h264");
        let ((encoded, raw, keyframes), snapshot) = run(false, Some(&path));
        println!("gravado em {} (abra com ffplay)", path.display());
        assert!(matches!(snapshot.encoder, EncoderKind::Hardware(_)));
        assert_eq!(raw, 0);
        // Pelo menos o keyframe do começo e o pedido no meio; mais os reenvios da tela parada.
        assert!(keyframes >= 2, "{keyframes} keyframes");
        assert!(encoded >= 5, "{encoded} frames");
    }

    #[test]
    #[ignore = "precisa de uma área de trabalho real"]
    fn plano_b_entrega_nv12() {
        let ((encoded, raw, _), snapshot) = run(true, None);
        assert_eq!(snapshot.encoder, EncoderKind::Software);
        assert_eq!(encoded, 0);
        assert!(raw >= 5, "{raw} frames");
    }

    #[test]
    #[ignore = "precisa de uma área de trabalho real e de encoder de hardware"]
    fn transmissoes_em_sequencia_no_mesmo_processo() {
        // Regressão: com um `MFShutdown` ao fim de cada transmissão, a seguinte derrubava o processo.
        for _ in 0..4 {
            let ((encoded, _, _), _) = run(false, None);
            assert!(encoded > 0);
        }
    }
}
