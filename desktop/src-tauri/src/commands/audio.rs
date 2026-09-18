use std::thread;

use tauri::ipc::Channel;

use crate::audio::{windows::WindowsSystemAudioCapture, ScreenShareAudioMode};

#[tauri::command]
pub fn start_screen_share_audio(
    channel: Channel<Vec<u8>>,
    process_id: u32,
    application: bool,
) -> Result<(), String> {
    let mode = if application {
        ScreenShareAudioMode::Application(process_id)
    } else {
        ScreenShareAudioMode::System(process_id)
    };

    thread::spawn(move || {
        let capture = match WindowsSystemAudioCapture::new(mode) {
            Ok(capture) => capture,
            Err(e) => {
                eprintln!("Erro ao criar captura de audio: {}", e);
                return;
            }
        };

        if let Err(error) = capture.stream_to_channel(channel) {
            eprintln!("Erro na capture de audio: {}", error)
        }
    });

    Ok(())
}
