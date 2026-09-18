// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod audio;
mod commands;

use commands::audio::{start_screen_share_audio, stop_screen_share_audio, ScreenShareAudioState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ScreenShareAudioState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            start_screen_share_audio,
            stop_screen_share_audio
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
