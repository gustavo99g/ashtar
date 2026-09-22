// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod error;
mod legacy;
mod media;

use legacy::commands::audio::{
    start_screen_share_audio, stop_screen_share_audio, ScreenShareAudioState,
};
use legacy::commands::screen_share::{
    ack_livekit_window_capture, list_screen_share_monitors, list_screen_share_windows,
    start_monitor_preview, start_screen_share_video, start_window_preview,
    stop_all_screen_share_previews, stop_livekit_window_capture, stop_screen_share_video,
    test_list_webrtc_windows, test_livekit_window_capture, ScreenSharePreviewState,
    ScreenShareVideoState,
};

use crate::legacy::screen_share::ScreenShareTestState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--enable-usermedia-screen-capturing --auto-select-desktop-capture-source=Entire screen",
    );

    tauri::Builder::default()
        .manage(ScreenShareAudioState::default())
        .manage(ScreenSharePreviewState::default())
        .manage(ScreenShareVideoState::default())
        .manage(ScreenShareTestState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            start_screen_share_audio,
            stop_screen_share_audio,
            list_screen_share_monitors,
            list_screen_share_windows,
            start_window_preview,
            start_monitor_preview,
            start_screen_share_video,
            stop_screen_share_video,
            stop_all_screen_share_previews,
            test_list_webrtc_windows,
            test_livekit_window_capture,
            ack_livekit_window_capture,
            stop_livekit_window_capture
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
