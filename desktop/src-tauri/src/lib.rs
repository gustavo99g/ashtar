//! Ponto de entrada da lib do app desktop (`desktop_lib`, ver `[lib] name` no
//! `Cargo.toml`). Registra os plugins, os comandos Tauri (em `commands/`) e o
//! estado gerenciado (o `ScreenShareManager`, criado no `setup`).
//!
//! Learn more about Tauri commands at <https://tauri.app/develop/calling-rust/>

// Todo bloco `unsafe` sem `// SAFETY: ...` vira aviso do clippy. A maior
// parte do FFI do projeto mora em `media::platform::win32`.
#![warn(clippy::undocumented_unsafe_blocks)]

mod api;
mod changelog;
mod commands;
mod deep_link;
mod error;
mod identity;
pub mod logging;
mod media;
mod updater;
mod window;

use tauri::{Manager, RunEvent};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

/// O que a janela lembra entre aberturas: tamanho, posição e se estava maximizada.
const WINDOW_STATE: StateFlags = StateFlags::SIZE
    .union(StateFlags::POSITION)
    .union(StateFlags::MAXIMIZED);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(log_file: logging::LateFile) {
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--enable-usermedia-screen-capturing --auto-select-desktop-capture-source=Entire screen",
    );

    let app = tauri::Builder::default()
        // O primeiro plugin: um segundo processo do app (aberto pelo link ou pelo menu Iniciar)
        // entrega os argumentos ao primeiro e fecha aqui, antes de os outros plugins rodarem.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            deep_link::bring_to_front(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(WINDOW_STATE)
                .build(),
        )
        .setup(move |app| {
            if let Err(error) = logging::attach_file(app.handle(), &log_file) {
                tracing::error!(%error, "não foi possível abrir o arquivo de log");
            }

            app.manage(commands::screen_share::create_manager(app.handle()));
            app.manage(commands::updater::create_auto_update(app.handle()));
            updater::spawn_periodic_check(app.handle().clone());
            deep_link::register_schemes(app);
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
            commands::app::whats_new,
            commands::identity::login,
            commands::identity::redeem,
            commands::identity::account_marker
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    // Antes do `run()`: a janela nasce no começo dele, e o window-state grava o arquivo nessa hora.
    let first_open = !window::has_saved_state(app.handle());

    app.run(move |app, event| match event {
        // A janela já existe (e o `setup` já rodou): na primeira abertura, cabe no monitor.
        RunEvent::Ready if first_open => window::fit_to_monitor(app),
        RunEvent::ExitRequested { .. } => {
            // O plugin grava o tamanho da janela no `RunEvent::Exit`, mas o instalador da
            // atualização encerra o processo antes dele. Por isso a gravação vem aqui, antes.
            if let Err(error) = app.save_window_state(WINDOW_STATE) {
                tracing::warn!(%error, "não foi possível gravar o tamanho da janela");
            }
            app.state::<updater::AutoUpdate>().install_on_exit();
        }
        RunEvent::Exit => logging::flush(app),
        _ => {}
    });
}
