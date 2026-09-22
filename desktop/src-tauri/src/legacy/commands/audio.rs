use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
};

use tauri::ipc::Channel;
use tracing::error;

use crate::legacy::audio::{windows::WindowsSystemAudioCapture, ScreenShareAudioMode};

struct ActiveCapture {
    id: u64,
    stop: Arc<AtomicBool>,
}

pub struct ScreenShareAudioState {
    next_id: AtomicU64,
    active: Arc<Mutex<Option<ActiveCapture>>>,
}

impl Default for ScreenShareAudioState {
    fn default() -> Self {
        Self {
            next_id: AtomicU64::new(0),
            active: Arc::new(Mutex::new(None)),
        }
    }
}

#[tauri::command]
pub fn start_screen_share_audio(
    state: tauri::State<'_, ScreenShareAudioState>,
    channel: Channel<Vec<u8>>,
    process_id: u32,
    application: bool,
) -> Result<u64, String> {
    let mode = if application {
        ScreenShareAudioMode::Application(process_id)
    } else {
        ScreenShareAudioMode::System(process_id)
    };

    let stop = Arc::new(AtomicBool::new(false));

    let id = state.next_id.fetch_add(1, Ordering::Relaxed);

    {
        let mut active = state
            .active
            .lock()
            .map_err(|_| "Falha ao acessar estado da captura".to_string())?;

        if active.is_some() {
            return Err("Já existe uma captura de áudio ativa".to_string());
        }

        *active = Some(ActiveCapture {
            id,
            stop: Arc::clone(&stop),
        })
    }

    let active_state = Arc::clone(&state.active);

    thread::Builder::new()
        .name("audio-capture".into())
        .spawn(move || {
            let capture = match WindowsSystemAudioCapture::new(mode) {
                Ok(capture) => capture,
                Err(e) => {
                    error!(capture_id = id, error = %e, "falha ao criar captura de áudio");
                    clear_active_capture(&active_state, id);
                    return;
                }
            };

            if let Err(error) = capture.stream_to_channel(channel, stop) {
                error!(capture_id = id, %error, "captura de áudio encerrada com erro");
            }
            clear_active_capture(&active_state, id);
        })
        .expect("falha ao criar thread audio-capture");

    Ok(id)
}

#[tauri::command]
pub fn stop_screen_share_audio(
    state: tauri::State<'_, ScreenShareAudioState>,
    capture_id: u64,
) -> Result<(), String> {
    let active = state
        .active
        .lock()
        .map_err(|_| "Falha ao acessar estado da captura".to_string())?;

    let Some(capture) = active.as_ref() else {
        return Ok(());
    };

    if capture.id != capture_id {
        return Err("ID da captura não corresponde à captura ativa".to_string());
    }
    capture.stop.store(true, Ordering::Relaxed);

    Ok(())
}

fn clear_active_capture(active_state: &Mutex<Option<ActiveCapture>>, capture_id: u64) {
    let Ok(mut active) = active_state.lock() else {
        return;
    };

    if active
        .as_ref()
        .is_some_and(|capture| capture.id == capture_id)
    {
        *active = None;
    }
}
