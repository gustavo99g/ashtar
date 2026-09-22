use fast_image_resize::{images::Image, PixelType, ResizeAlg, ResizeOptions, Resizer};
use livekit::webrtc::{
    desktop_capturer::{
        DesktopCaptureSourceType, DesktopCapturer, DesktopCapturerOptions, DesktopFrame,
    },
    native::yuv_helper::argb_to_i420,
    video_frame::{I420Buffer, VideoFrame, VideoRotation},
    video_source::{native::NativeVideoSource, VideoResolution},
};
use tauri::ipc::{Channel, InvokeResponseBody};
use tracing::{debug, info, warn};

use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Clone)]
pub struct CaptureControl {
    pub(crate) in_flight: Arc<AtomicU64>,
    pub(crate) stop: Arc<AtomicBool>,

    pub(crate) captured: Arc<AtomicU64>,
    pub(crate) dropped: Arc<AtomicU64>,
    pub(crate) sent: Arc<AtomicU64>,
}

#[derive(Clone)]
pub struct ScreenShareTestState {
    pub(crate) next_id: Arc<AtomicU64>,
    pub(crate) captures: Arc<Mutex<std::collections::HashMap<u64, CaptureControl>>>,
}
impl Default for ScreenShareTestState {
    fn default() -> Self {
        Self {
            next_id: Arc::new(AtomicU64::new(1)),
            captures: Arc::new(Mutex::new(std::collections::HashMap::new())),
        }
    }
}

// ===== PROFILING: acumuladores de tempo por etapa do pipeline =====
struct StageTimings {
    resize_total: Duration,
    i420_total: Duration,
    pack_total: Duration,
    send_total: Duration,
    frame_total: Duration, // tempo do callback inteiro, ponta a ponta
    count: u64,
}

impl StageTimings {
    fn new() -> Self {
        Self {
            resize_total: Duration::ZERO,
            i420_total: Duration::ZERO,
            pack_total: Duration::ZERO,
            send_total: Duration::ZERO,
            frame_total: Duration::ZERO,
            count: 0,
        }
    }

    fn report(&mut self) {
        if self.count == 0 {
            return;
        }
        let n = self.count as f64;
        let avg_frame_ms = self.frame_total.as_secs_f64() * 1000.0 / n;
        debug!(
            target: "perf",
            n = self.count,
            resize_ms = self.resize_total.as_secs_f64() * 1000.0 / n,
            i420_ms = self.i420_total.as_secs_f64() * 1000.0 / n,
            pack_ms = self.pack_total.as_secs_f64() * 1000.0 / n,
            send_ms = self.send_total.as_secs_f64() * 1000.0 / n,
            total_ms = avg_frame_ms,
            fps_max = 1000.0 / avg_frame_ms,
            "pipeline stats"
        );
        *self = StageTimings::new();
    }
}

pub fn test_capture_window(
    source_id: u64,
    channel: Channel<InvokeResponseBody>,
    control: CaptureControl,
) -> Result<(), String> {
    const MAX_IN_FLIGHT: u64 = 3;

    const TARGET_WIDTH: u32 = 1280;

    let mut options = DesktopCapturerOptions::new(DesktopCaptureSourceType::Window);

    options.set_include_cursor(true);

    let mut capturer = DesktopCapturer::new(options)
        .ok_or_else(|| "Não foi possível criar o DesktopCapturer.".to_string())?;

    let source = capturer
        .get_source_list()
        .into_iter()
        .find(|source| source.id() == source_id)
        .ok_or_else(|| format!("HWND {source_id} não encontrado."))?;

    let stop = Arc::clone(&control.stop);

    let captured = Arc::clone(&control.captured);
    let dropped = Arc::clone(&control.dropped);
    let sent = Arc::clone(&control.sent);
    let in_flight = Arc::clone(&control.in_flight);

    let mut resizer = Resizer::new();

    // ===== PROFILING: estado compartilhado de timings =====
    let timings = Arc::new(Mutex::new(StageTimings::new()));
    let timings_cb = Arc::clone(&timings);

    capturer.start_capture(Some(source), move |result| match result {
        Ok(frame) => {
            let frame_start = Instant::now();

            captured.fetch_add(1, Ordering::Relaxed);

            let current = in_flight.fetch_add(1, Ordering::AcqRel);

            if current >= MAX_IN_FLIGHT {
                in_flight.fetch_sub(1, Ordering::AcqRel);
                dropped.fetch_add(1, Ordering::Relaxed);
                return;
            }

            let capture_timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_micros() as u64;

            // --- RESIZE ---
            let t0 = Instant::now();
            let (bgra, w, h) = match resize_bgra(&frame, &mut resizer, TARGET_WIDTH) {
                Ok(r) => r,
                Err(e) => {
                    warn!(error = %e, "resize do frame capturado falhou, frame descartado");
                    in_flight.fetch_sub(1, Ordering::AcqRel);
                    return;
                }
            };
            let resize_elapsed = t0.elapsed();

            // --- I420 ---
            let t1 = Instant::now();
            let i420 = desktop_bgra_to_i420(&bgra, w, h);
            let i420_elapsed = t1.elapsed();

            let send_timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_micros() as u64;

            // --- PACK ---
            let t2 = Instant::now();
            let payload = pack_i420(&i420, w, h, capture_timestamp, send_timestamp);
            let pack_elapsed = t2.elapsed();

            // --- SEND ---
            let t3 = Instant::now();
            let send_ok = channel.send(InvokeResponseBody::Raw(payload)).is_ok();
            let send_elapsed = t3.elapsed();

            if !send_ok {
                in_flight.fetch_sub(1, Ordering::AcqRel);
                stop.store(true, Ordering::Release);
                return;
            }

            sent.fetch_add(1, Ordering::Relaxed);

            let frame_elapsed = frame_start.elapsed();

            // ===== PROFILING: acumula os tempos desta etapa =====
            if let Ok(mut t) = timings_cb.lock() {
                t.resize_total += resize_elapsed;
                t.i420_total += i420_elapsed;
                t.pack_total += pack_elapsed;
                t.send_total += send_elapsed;
                t.frame_total += frame_elapsed;
                t.count += 1;
            }
        }

        Err(error) => {
            warn!(?error, "DesktopCapturer retornou erro para o frame");
        }
    });

    let mut last_report = Instant::now();

    let mut last_captured = 0;
    let mut last_dropped = 0;
    let mut last_sent = 0;

    let mut capture_calls = 0u64;
    let mut capture_total = Duration::ZERO;
    let mut last_capture_report = Instant::now();

    // ===== PROFILING: controla o intervalo de report do pipeline =====
    let mut last_timing_report = Instant::now();

    while !control.stop.load(Ordering::Acquire) {
        if control.in_flight.load(Ordering::Acquire) < MAX_IN_FLIGHT {
            let start = Instant::now();

            capturer.capture_frame();

            capture_total += start.elapsed();
            capture_calls += 1;

            if last_capture_report.elapsed() >= Duration::from_secs(1) {
                if capture_calls > 0 {
                    let avg = capture_total.as_secs_f64() * 1000.0 / capture_calls as f64;

                    debug!(target: "perf", calls = capture_calls, avg_ms = avg, "capture_frame() calls");
                }

                capture_calls = 0;
                capture_total = Duration::ZERO;
                last_capture_report = Instant::now();
            }
        } else {
            thread::sleep(Duration::from_millis(1));
        }

        if last_report.elapsed() >= Duration::from_secs(1) {
            let current_captured = control.captured.load(Ordering::Relaxed);
            let current_dropped = control.dropped.load(Ordering::Relaxed);
            let current_sent = control.sent.load(Ordering::Relaxed);
            let current_in_flight = control.in_flight.load(Ordering::Relaxed);

            debug!(
                target: "perf",
                captured = current_captured - last_captured,
                dropped = current_dropped - last_dropped,
                sent = current_sent - last_soent,
                in_flight = current_in_flight,
                "capture stats"
            );

            last_captured = current_captured;
            last_dropped = current_dropped;
            last_sent = current_sent;

            last_report = Instant::now();
        }

        // ===== PROFILING: imprime médias do pipeline a cada 1s =====
        if last_timing_report.elapsed() >= Duration::from_secs(1) {
            if let Ok(mut t) = timings.lock() {
                t.report();
            }
            last_timing_report = Instant::now();
        }
    }

    Ok(())
}

fn resize_bgra(
    frame: &DesktopFrame,
    resizer: &mut Resizer,
    target_width: u32,
) -> Result<(Vec<u8>, u32, u32), String> {
    let source_width = frame.width() as u32;
    let source_height = frame.height() as u32;

    let target_height =
        ((source_height as u64 * target_width as u64) / source_width as u64) as u32 & !1;

    let mut source_data = frame.data().to_vec();

    let source = Image::from_slice_u8(
        source_width,
        source_height,
        &mut source_data,
        PixelType::U8x4,
    )
    .map_err(|e| format!("Erro ao criar imagem fonte: {e}"))?;

    let mut destination = Image::new(target_width, target_height, PixelType::U8x4);

    let options = ResizeOptions::new()
        .resize_alg(ResizeAlg::Nearest)
        .use_alpha(false);

    resizer
        .resize(&source, &mut destination, Some(&options))
        .map_err(|e| format!("Erro no resize: {e}"))?;

    Ok((destination.into_vec(), target_width, target_height))
}

fn desktop_bgra_to_i420(data: &[u8], width: u32, height: u32) -> I420Buffer {
    let mut buffer = I420Buffer::new(width, height);

    let (stride_y, stride_u, stride_v) = buffer.strides();

    {
        let (dst_y, dst_u, dst_v) = buffer.data_mut();

        argb_to_i420(
            data,
            width * 4,
            dst_y,
            stride_y,
            dst_u,
            stride_u,
            dst_v,
            stride_v,
            width as i32,
            height as i32,
        );
    }

    buffer
}

fn pack_i420(
    buffer: &I420Buffer,
    width: u32,
    height: u32,
    capture_timestamp: u64,
    send_timestamp: u64,
) -> Vec<u8> {
    let (y, u, v) = buffer.data();
    let (stride_y, stride_u, stride_v) = buffer.strides();

    let width = width as usize;
    let height = height as usize;

    let chroma_width = width.div_ceil(2);
    let chroma_height = height.div_ceil(2);

    let y_size = width * height;
    let uv_size = chroma_width * chroma_height;

    let mut payload = Vec::with_capacity(24 + y_size + uv_size * 2);

    payload.extend_from_slice(&(width as u32).to_le_bytes());
    payload.extend_from_slice(&(height as u32).to_le_bytes());
    payload.extend_from_slice(&capture_timestamp.to_le_bytes());
    payload.extend_from_slice(&send_timestamp.to_le_bytes());

    // Y
    for row in 0..height {
        let start = row * stride_y as usize;
        payload.extend_from_slice(&y[start..start + width]);
    }

    // U
    for row in 0..chroma_height {
        let start = row * stride_u as usize;
        payload.extend_from_slice(&u[start..start + chroma_width]);
    }

    // V
    for row in 0..chroma_height {
        let start = row * stride_v as usize;
        payload.extend_from_slice(&v[start..start + chroma_width]);
    }

    payload
}

pub fn list_webrtc_windows() -> Result<(), String> {
    let mut options = DesktopCapturerOptions::new(DesktopCaptureSourceType::Window);

    options.set_include_cursor(false);

    let capturer = DesktopCapturer::new(options)
        .ok_or_else(|| "Não foi possível criar DesktopCapturer.".to_string())?;

    let sources = capturer.get_source_list();

    info!(
        count = sources.len(),
        "fontes encontradas no DesktopCapturer"
    );

    for source in sources {
        info!(
            id = source.id(),
            title = ?source.title(),
            display_id = source.display_id(),
            "fonte do DesktopCapturer"
        );
    }

    Ok(())
}
