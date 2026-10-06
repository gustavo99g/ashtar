//! Ponto de entrada da lib do app desktop (`desktop_lib`, ver `[lib] name` no
//! `Cargo.toml`). Registra os comandos Tauri (em `commands/`) e o estado
//! gerenciado (o `ScreenShareManager`, criado no `setup`).
//!
//! Learn more about Tauri commands at <https://tauri.app/develop/calling-rust/>

// Todo bloco `unsafe` sem `// SAFETY: ...` vira aviso do clippy. A maior
// parte do FFI do projeto mora em `media::platform::win32`.
#![warn(clippy::undocumented_unsafe_blocks)]

mod commands;
mod error;
mod media;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--enable-usermedia-screen-capturing --auto-select-desktop-capture-source=Entire screen",
    );

    tauri::Builder::default()
        .setup(|app| {
            app.manage(commands::screen_share::create_manager(app.handle()));
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::screen_share::list_capture_sources,
            commands::screen_share::ipc_screen_share_start,
            commands::screen_share::ipc_screen_share_ack,
            commands::screen_share::screen_share_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
