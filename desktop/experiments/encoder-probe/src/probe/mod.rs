//! Orquestra a medição: abre a captura, o conversor e o encoder, roda o laço no ritmo do fps
//! pedido e imprime o relatório.
//!
//! Uma thread só, sem bloquear: a cada volta processa os eventos do encoder e, no deadline do
//! próximo frame, pega a imagem mais nova do WGC, converte na GPU e entrega ao encoder.

mod args;
mod capture;
mod convert;
mod encoder;
mod gpu;
mod stats;

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::time::{Duration, Instant};

use windows::Win32::Media::MediaFoundation::{
    MFShutdown, MFStartup, MFVideoFormat_AV1, MFVideoFormat_H264, MFVideoFormat_HEVC,
    MFSTARTUP_FULL, MF_VERSION,
};
use windows::Win32::Media::{timeBeginPeriod, timeEndPeriod};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

use args::Args;
use capture::Capture;
use convert::{Converter, RING};
use encoder::{Encoder, EncoderConfig, Event};
use gpu::Gpu;
use stats::{CpuClock, Series};

/// Quanto esperar pelo primeiro frame do WGC antes de desistir.
const FIRST_FRAME_TIMEOUT: Duration = Duration::from_secs(3);
/// Quanto esperar o encoder soltar os últimos frames no fim.
const DRAIN_TIMEOUT: Duration = Duration::from_secs(2);

pub fn run() -> Result<(), String> {
    let Some(args) = args::parse()? else {
        return Ok(());
    };

    // SAFETY: inicializações de processo, chamadas uma vez antes de qualquer uso de COM/MF; o
    // `timeBeginPeriod(1)` deixa o `sleep` com resolução de 1 ms (o padrão é ~15,6 ms).
    unsafe {
        RoInitialize(RO_INIT_MULTITHREADED).map_err(err("RoInitialize"))?;
        MFStartup(MF_VERSION, MFSTARTUP_FULL).map_err(err("MFStartup"))?;
        timeBeginPeriod(1);
    }

    let result = measure(&args);

    // SAFETY: encerramentos pareados com as inicializações acima.
    unsafe {
        timeEndPeriod(1);
        let _ = MFShutdown();
    }
    result
}

fn err(what: &'static str) -> impl Fn(windows::core::Error) -> String {
    move |e| format!("{what}: {} ({:?})", e.message(), e.code())
}

fn measure(args: &Args) -> Result<(), String> {
    let gpu = Gpu::new().map_err(err("D3D11CreateDevice"))?;
    let monitors = gpu::monitors();
    let h264 = encoder::hardware_encoders(MFVideoFormat_H264).map_err(err("MFTEnumEx"))?;

    if args.list {
        println!("Adaptador do dispositivo D3D11: {}", gpu.adapter_name());
        println!("\nTelas:");
        for (i, m) in monitors.iter().enumerate() {
            let primary = if m.primary { " (principal)" } else { "" };
            println!("  [{i}] {} {}x{}{primary}", m.name, m.width, m.height);
        }
        println!("\nEncoders de hardware H.264:");
        if h264.is_empty() {
            println!("  nenhum");
        }
        for (i, e) in h264.iter().enumerate() {
            println!("  [{i}] {}", e.name);
        }
        for (label, codec) in [("HEVC", MFVideoFormat_HEVC), ("AV1", MFVideoFormat_AV1)] {
            let names: Vec<String> = encoder::hardware_encoders(codec)
                .unwrap_or_default()
                .into_iter()
                .map(|e| e.name)
                .collect();
            println!(
                "Encoders de hardware {label}: {}",
                if names.is_empty() {
                    "nenhum".into()
                } else {
                    names.join(", ")
                }
            );
        }
        return Ok(());
    }

    let monitor = match args.monitor {
        Some(i) => monitors
            .get(i)
            .ok_or(format!("não há tela {i} (veja --list)"))?,
        None => monitors
            .iter()
            .find(|m| m.primary)
            .or(monitors.first())
            .ok_or("nenhuma tela encontrada")?,
    };
    let info = h264.get(args.encoder).ok_or(if h264.is_empty() {
        "nenhum encoder H.264 de hardware encontrado".to_string()
    } else {
        format!("não há encoder {} (veja --list)", args.encoder)
    })?;

    let capture = Capture::monitor(&gpu.device, monitor.handle).map_err(err("WGC"))?;
    let (out_w, out_h) = args::fit_in_box(capture.width, capture.height, args.size);
    let converter = Converter::new(
        &gpu.device,
        &gpu.context,
        (capture.width, capture.height),
        (out_w, out_h),
        args.fps,
    )
    .map_err(err("VideoProcessor"))?;
    let bitrate_bps = args.bitrate_kbps * 1000;
    let mut encoder = Encoder::new(
        info,
        &gpu.device,
        &EncoderConfig {
            width: out_w,
            height: out_h,
            fps: args.fps,
            bitrate_bps,
            profile: args.profile,
            // Keyframe natural raro: no WebRTC eles vêm sob pedido (quem entra, perda de pacote).
            gop_frames: args.fps * 10,
        },
    )
    .map_err(err("encoder"))?;

    println!("Adaptador:  {}", gpu.adapter_name());
    println!("Encoder:    {}", info.name);
    println!(
        "Tela:       {} {}x{} → saída {}x{} @ {} fps, {} kbps, perfil {:?}",
        monitor.name,
        capture.width,
        capture.height,
        out_w,
        out_h,
        args.fps,
        args.bitrate_kbps,
        args.profile
    );
    println!("WGC:        {}", capture.notes.join(" · "));
    println!(
        "Conversão:  espaço de cor BT.709 {}",
        if converter.color_space_set {
            "definido"
        } else {
            "padrão do driver"
        }
    );
    println!("Encoder:    {}", encoder.notes.join(" · "));
    println!(
        "Modo:       {}",
        if args.only_new {
            "só imagens novas"
        } else {
            "fps fixo (repete a última imagem)"
        }
    );
    println!(
        "\nMedindo por {} s… deixe algo se mexendo na tela (vídeo ou jogo).",
        args.seconds
    );

    let mut file = match &args.out {
        Some(path) => {
            Some(BufWriter::new(File::create(path).map_err(|e| {
                format!("não deu para criar {}: {e}", path.display())
            })?))
        }
        None => None,
    };

    // Espera o primeiro frame, para a medição não começar com a fila vazia.
    let waiting = Instant::now();
    loop {
        if capture.latest(|t| converter.store(t)).map_err(err("WGC"))? {
            break;
        }
        if waiting.elapsed() > FIRST_FRAME_TIMEOUT {
            return Err("o WGC não entregou nenhum frame em 3 s".into());
        }
        std::thread::sleep(Duration::from_millis(5));
    }

    let interval = Duration::from_secs(1) / args.fps;
    let frame_100ns = 10_000_000 / i64::from(args.fps);
    let total = Duration::from_secs(u64::from(args.seconds));
    let half = total / 2;
    let keyframe_every = Duration::from_secs(u64::from(args.keyframe_every_s));

    let mut r = Report::default();
    let mut submitted: HashMap<i64, Instant> = HashMap::new();
    let mut in_flight = 0usize;
    let mut slot = 0usize;
    let mut last_output: Option<Instant> = None;
    let mut pending_keyframe: Option<i64> = None;
    let mut next_keyframe = keyframe_every;
    let mut bitrate_changed = false;

    let cpu = CpuClock::start();
    let start = Instant::now();
    let mut next = start;

    let handle = |event: Event,
                  r: &mut Report,
                  submitted: &mut HashMap<i64, Instant>,
                  last_output: &mut Option<Instant>,
                  in_flight: &mut usize,
                  pending_keyframe: &mut Option<i64>,
                  file: &mut Option<BufWriter<File>>|
     -> Result<bool, String> {
        let Event::Output(out) = event else {
            return Ok(true); // DrainComplete
        };
        let now = Instant::now();
        r.outputs += 1;
        *in_flight = in_flight.saturating_sub(1);
        match submitted.remove(&out.time) {
            Some(t0) => r.latency.push(now - t0),
            None => r.unmatched += 1,
        }
        if let Some(prev) = last_output.replace(now) {
            r.output_gap.push(now - prev);
        }
        let in_second_half = out.time >= half.as_nanos() as i64 / 100;
        if in_second_half {
            r.bytes_second += out.data.len() as u64;
        } else {
            r.bytes_first += out.data.len() as u64;
        }
        if out.keyframe {
            r.keyframes += 1;
            if let Some(asked) = *pending_keyframe {
                if out.time >= asked {
                    r.keyframe_delay_frames
                        .push((out.time - asked) / frame_100ns);
                    *pending_keyframe = None;
                }
            }
        }
        if let Some(f) = file {
            f.write_all(&out.data)
                .map_err(|e| format!("gravando o .h264: {e}"))?;
        }
        Ok(false)
    };

    loop {
        for event in encoder.poll().map_err(err("eventos do encoder"))? {
            handle(
                event,
                &mut r,
                &mut submitted,
                &mut last_output,
                &mut in_flight,
                &mut pending_keyframe,
                &mut file,
            )?;
        }

        let now = Instant::now();
        let elapsed = now - start;
        if elapsed >= total {
            break;
        }
        if now < next {
            std::thread::sleep((next - now).min(Duration::from_millis(1)));
            continue;
        }
        next += interval;
        if next <= now {
            next = now + interval;
        }
        r.ticks += 1;

        let work = Instant::now();
        let new = capture.latest(|t| converter.store(t)).map_err(err("WGC"))?;
        if new {
            r.new_frames += 1;
        } else if args.only_new {
            r.skipped_same += 1;
            continue;
        }
        if encoder.need_input == 0 || in_flight >= RING - 1 {
            r.dropped_busy += 1;
            continue;
        }

        if args.bitrate_change && !bitrate_changed && elapsed >= half {
            r.bitrate_change_accepted = Some(encoder.set_bitrate(bitrate_bps / 2));
            bitrate_changed = true;
        }
        let time = elapsed.as_nanos() as i64 / 100;
        if args.keyframe_every_s > 0 && elapsed >= next_keyframe {
            next_keyframe += keyframe_every;
            if encoder.force_keyframe() {
                r.keyframe_requests += 1;
                pending_keyframe.get_or_insert(time);
            } else {
                r.keyframe_refused += 1;
            }
        }

        let texture = converter.convert(slot).map_err(err("VideoProcessorBlt"))?;
        slot += 1;
        encoder.submit(texture, time).map_err(err("ProcessInput"))?;
        submitted.insert(time, work);
        in_flight += 1;
        r.submitted += 1;
        r.cpu_per_frame.push(work.elapsed());
    }
    let measured = start.elapsed();
    let (cpu_one_core, cpu_machine) = cpu.usage();

    // Solta o que ficou no encoder (não entra no tempo nem na CPU medidos).
    encoder.start_drain().map_err(err("drain"))?;
    let draining = Instant::now();
    'drain: while draining.elapsed() < DRAIN_TIMEOUT {
        for event in encoder.poll().map_err(err("eventos do encoder"))? {
            if handle(
                event,
                &mut r,
                &mut submitted,
                &mut last_output,
                &mut in_flight,
                &mut pending_keyframe,
                &mut file,
            )? {
                break 'drain;
            }
        }
        std::thread::sleep(Duration::from_millis(1));
    }
    if let Some(f) = &mut file {
        f.flush().map_err(|e| format!("gravando o .h264: {e}"))?;
    }

    r.print(
        args,
        measured,
        half,
        cpu_one_core,
        cpu_machine,
        &encoder.notes,
    );
    Ok(())
}

#[derive(Default)]
struct Report {
    ticks: u64,
    new_frames: u64,
    skipped_same: u64,
    dropped_busy: u64,
    submitted: u64,
    outputs: u64,
    unmatched: u64,
    keyframes: u64,
    keyframe_requests: u64,
    keyframe_refused: u64,
    keyframe_delay_frames: Vec<i64>,
    bitrate_change_accepted: Option<bool>,
    bytes_first: u64,
    bytes_second: u64,
    cpu_per_frame: Series,
    latency: Series,
    output_gap: Series,
}

impl Report {
    fn print(
        &self,
        args: &Args,
        measured: Duration,
        half: Duration,
        cpu_one_core: f64,
        cpu_machine: f64,
        notes: &[String],
    ) {
        let secs = measured.as_secs_f64();
        let fps = |n: u64| n as f64 / secs;
        let kbps =
            |bytes: u64, d: Duration| bytes as f64 * 8.0 / d.as_secs_f64().max(1e-9) / 1000.0;

        println!("\n================ RESULTADO ================");
        println!("Duração medida:           {secs:.1} s");
        println!(
            "Frames:                   {} no relógio · {} imagens novas do WGC ({:.1}/s)",
            self.ticks,
            self.new_frames,
            fps(self.new_frames)
        );
        println!(
            "Ao encoder:               {} ({:.1} fps) · saídas {} ({:.1} fps)",
            self.submitted,
            fps(self.submitted),
            self.outputs,
            fps(self.outputs)
        );
        println!(
            "Descartados:              {} com o encoder ocupado · {} sem imagem nova",
            self.dropped_busy, self.skipped_same
        );
        println!(
            "CPU do processo:          {cpu_one_core:.1}% de um núcleo ({cpu_machine:.2}% da máquina)"
        );
        println!("CPU por frame (laço):     {}", self.cpu_per_frame.summary());
        println!("Captura → H.264 pronto:   {}", self.latency.summary());
        println!("Intervalo entre saídas:   {}", self.output_gap.summary());
        if self.unmatched > 0 {
            println!(
                "  atenção: {} saídas com tempo diferente do enviado (latência sem esses)",
                self.unmatched
            );
        }

        let target = args.bitrate_kbps;
        if args.bitrate_change {
            let second = measured.saturating_sub(half);
            println!(
                "Bitrate real:             1ª metade {:.0} kbps (alvo {target}) · 2ª metade {:.0} kbps (alvo {})",
                kbps(self.bytes_first, half),
                kbps(self.bytes_second, second),
                target / 2
            );
            println!(
                "Troca de bitrate:         {}",
                match self.bitrate_change_accepted {
                    Some(true) => "aceita",
                    Some(false) => "RECUSADA",
                    None => "não chegou a acontecer",
                }
            );
        } else {
            println!(
                "Bitrate real:             {:.0} kbps (alvo {target})",
                kbps(self.bytes_first + self.bytes_second, measured)
            );
        }

        let delays = if self.keyframe_delay_frames.is_empty() {
            "nenhum atendido".to_string()
        } else {
            let list: Vec<String> = self
                .keyframe_delay_frames
                .iter()
                .map(|d| d.to_string())
                .collect();
            format!("atrasos em frames: {}", list.join(", "))
        };
        println!(
            "Keyframes:                {} no total · {} pedidos ({} recusados) · {delays}",
            self.keyframes, self.keyframe_requests, self.keyframe_refused
        );
        if !notes.is_empty() {
            println!("Notas do encoder:         {}", notes.join(" · "));
        }
        if self.latency.len() == 0 {
            println!("\natenção: nenhuma latência medida; mande a saída inteira assim mesmo.");
        }
        println!("===========================================");
    }
}
