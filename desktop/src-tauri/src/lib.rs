//! Ponto de entrada da lib do app desktop (`desktop_lib`, ver `[lib] name` no
//! `Cargo.toml`). Registra os comandos Tauri (em `commands/`) e o estado
//! gerenciado (o `ScreenShareManager`, criado no `setup`).
//!
//! Learn more about Tauri commands at <https://tauri.app/develop/calling-rust/>

// Todo bloco `unsafe` sem `// SAFETY: ...` vira aviso do clippy. A maior
// parte do FFI do projeto mora em `media::platform::win32`.
#![warn(clippy::undocumented_unsafe_blocks)]

mod changelog;
mod commands;
mod error;
pub mod logging;
mod media;
mod updater;

use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(log_file: logging::LateFile) {
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--enable-usermedia-screen-capturing --auto-select-desktop-capture-source=Entire screen",
    );

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            if let Err(error) = logging::attach_file(app.handle(), &log_file) {
                tracing::error!(%error, "não foi possível abrir o arquivo de log");
            }

            app.manage(commands::screen_share::create_manager(app.handle()));
            app.manage(commands::updater::create_auto_update(app.handle()));
            updater::spawn_periodic_check(app.handle().clone());
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::screen_share::list_capture_sources,
            commands::screen_share::ipc_screen_share_start,
            commands::screen_share::ipc_screen_share_ack,
            commands::screen_share::screen_share_stop,
            commands::updater::pending_update,
            commands::updater::install_update,
            commands::updater::check_for_update,
            commands::app::whats_new
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app, event| match event {
        RunEvent::ExitRequested { .. } => app.state::<updater::AutoUpdate>().install_on_exit(),
        RunEvent::Exit => logging::flush(app),
        _ => {}
    });
}
