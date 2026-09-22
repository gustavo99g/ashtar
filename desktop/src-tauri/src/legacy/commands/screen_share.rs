use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
};

use livekit::webrtc::video_source::{native::NativeVideoSource, VideoResolution};
use tauri::ipc::{Channel, InvokeResponseBody};
use tracing::{error, warn};

use crate::legacy::screen_share::{
    test_capture_window,
    windows::{
        list_monitors, list_windows, stream_monitor_preview, stream_screen_share_video,
        stream_window_preview, ScreenShareVideoSource,
    },
    CaptureControl, MonitorSource, ScreenShareTestState, WindowPreviewFrame, WindowSource,
};

pub struct ScreenSharePreviewState {
    previews: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

pub struct ScreenShareVideoState {
    stop: Arc<Mutex<Option<Arc<AtomicBool>>>>,
}

impl Default for ScreenShareVideoState {
    fn default() -> Self {
        Self {
            stop: Arc::new(Mutex::new(None)),
        }
    }
}

impl Default for ScreenSharePreviewState {
    fn default() -> Self {
        Self {
            previews: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

fn start_preview(
    state: &ScreenSharePreviewState,
    key: String,
    stop: Arc<AtomicBool>,
) -> Result<(), String> {
    let mut previews = state
        .previews
        .lock()
        .map_err(|_| "Falha ao acessar previews".to_string())?;

    if let Some(previous) = previews.insert(key, Arc::clone(&stop)) {
        previous.store(true, Ordering::Relaxed);
    }

    Ok(())
}

#[tauri::command]
pub fn start_window_preview(
    state: tauri::State<'_, ScreenSharePreviewState>,
    source_id: u64,
    channel: Channel<WindowPreviewFrame>,
) -> Result<(), String> {
    let stop = Arc::new(AtomicBool::new(false));

    start_preview(&state, format!("window:{source_id}"), Arc::clone(&stop))?;

    let previews = Arc::clone(&state.previews);
    let key = format!("window:{source_id}");

    std::thread::Builder::new()
        .name("window-preview".into())
        .spawn(move || {
            match crate::legacy::screen_share::windows::capture_window_snapshot(source_id) {
                Ok(frame) => {
                    if let Err(error) = channel.send(frame) {
                        error!(source_id, %error, "erro ao enviar snapshot inicial do preview");

                        if let Ok(mut previews) = previews.lock() {
                            previews.remove(&key);
                        }

                        return;
                    }
                }

                Err(error) => {
                    warn!(source_id, %error, "snapshot inicial indisponível para preview de janela");
                }
            }

            if let Err(error) = stream_window_preview(source_id, channel, Arc::clone(&stop)) {
                warn!(source_id, %error, "preview da janela encerrado com erro");
            }

            if let Ok(mut previews) = previews.lock() {
                previews.remove(&key);
            }
        })
        .expect("falha ao criar thread window-preview");
    Ok(())
}

#[tauri::command]
pub fn start_monitor_preview(
    state: tauri::State<'_, ScreenSharePreviewState>,
    source_id: u64,
    channel: Channel<WindowPreviewFrame>,
) -> Result<(), String> {
    let stop = Arc::new(AtomicBool::new(false));

    start_preview(&state, format!("monitor:{source_id}"), Arc::clone(&stop))?;

    let previews = Arc::clone(&state.previews);
    let key = format!("monitor:{source_id}");

    thread::Builder::new()
        .name("monitor-preview".into())
        .spawn(move || {
            if let Err(error) = stream_monitor_preview(source_id, channel, Arc::clone(&stop)) {
                warn!(source_id, %error, "preview do monitor encerrado com erro");
            }

            if let Ok(mut previews) = previews.lock() {
                previews.remove(&key);
            }
        })
        .expect("falha ao criar thread monitor-preview");

    Ok(())
}

#[tauri::command]
pub fn start_screen_share_video(
    state: tauri::State<'_, ScreenShareVideoState>,
    source_type: String,
    source_id: u64,
    channel: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    let source = match source_type.as_str() {
        "window" => ScreenShareVideoSource::Window(source_id),

        "monitor" => ScreenShareVideoSource::Monitor(source_id),

        _ => {
            return Err("Tipo de fonte inválido.".to_string());
        }
    };

    let stop = Arc::new(AtomicBool::new(false));

    {
        let mut active = state
            .stop
            .lock()
            .map_err(|_| "Falha ao acessar estado.".to_string())?;

        if active.is_some() {
            return Err("Já existe um screen share ativo.".to_string());
        }

        *active = Some(Arc::clone(&stop));
    }

    let state_stop = Arc::clone(&state.stop);

    std::thread::Builder::new()
        .name("screen-share-video".into())
        .spawn(move || {
            let result = stream_screen_share_video(source, channel, stop);

            if let Err(error) = result {
                error!(source_id, %error, "screen share (WGC) encerrado com erro");
            }

            if let Ok(mut active) = state_stop.lock() {
                *active = None;
            }
        })
        .expect("falha ao criar thread screen-share-video");

    Ok(())
}

#[tauri::command]
pub fn stop_all_screen_share_previews(
    state: tauri::State<'_, ScreenSharePreviewState>,
) -> Result<(), String> {
    let mut previews = state
        .previews
        .lock()
        .map_err(|_| "Falha ao acessar previews".to_string())?;

    for stop in previews.values() {
        stop.store(true, Ordering::Relaxed);
    }

    previews.clear();

    Ok(())
}

#[tauri::command]
pub fn stop_screen_share_video(
    state: tauri::State<'_, ScreenShareVideoState>,
) -> Result<(), String> {
    let mut active = state
        .stop
        .lock()
        .map_err(|_| "Falha ao acessar estado.".to_string())?;

    if let Some(stop) = active.take() {
        stop.store(true, Ordering::Relaxed);
    }

    Ok(())
}

#[tauri::command]
pub fn list_screen_share_windows() -> Result<Vec<WindowSource>, String> {
    list_windows()
}

#[tauri::command]
pub fn list_screen_share_monitors() -> Result<Vec<MonitorSource>, String> {
    list_monitors()
}

// WEBRTC LIVEKIT

#[tauri::command]
pub fn test_list_webrtc_windows() -> Result<(), String> {
    crate::legacy::screen_share::list_webrtc_windows()
}

#[tauri::command]
pub fn test_livekit_window_capture(
    state: tauri::State<'_, ScreenShareTestState>,
    source_id: u64,
    channel: Channel<InvokeResponseBody>,
) -> Result<u64, String> {
    let capture_id = state.next_id.fetch_add(1, Ordering::Relaxed);

    let control = CaptureControl {
        in_flight: Arc::new(AtomicU64::new(0)),
        stop: Arc::new(AtomicBool::new(false)),
        captured: Arc::new(AtomicU64::new(0)),
        dropped: Arc::new(AtomicU64::new(0)),
        sent: Arc::new(AtomicU64::new(0)),
    };

    state
        .captures
        .lock()
        .unwrap()
        .insert(capture_id, control.clone());

    tauri::async_runtime::spawn_blocking(move || {
        let result = test_capture_window(source_id, channel, control);

        if let Err(error) = result {
            error!(capture_id, %error, "captura de vídeo (DesktopCapturer) encerrada com erro");
        }
    });

    Ok(capture_id)
}

#[tauri::command]
pub fn ack_livekit_window_capture(
    state: tauri::State<'_, ScreenShareTestState>,
    capture_id: u64,
) -> Result<(), String> {
    let captures = state.captures.lock().unwrap();

    let control = captures
        .get(&capture_id)
        .ok_or_else(|| format!("Captura {capture_id} não encontrada."))?;

    control.in_flight.fetch_sub(1, Ordering::AcqRel);

    Ok(())
}

#[tauri::command]
pub fn stop_livekit_window_capture(
    state: tauri::State<'_, ScreenShareTestState>,
    capture_id: u64,
) -> Result<(), String> {
    let mut captures = state.captures.lock().unwrap();

    if let Some(control) = captures.remove(&capture_id) {
        control.stop.store(true, Ordering::Release);
    }

    Ok(())
}
