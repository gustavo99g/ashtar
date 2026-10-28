//! Binário do app desktop. Só inicializa observabilidade (`logging::init`,
//! incluindo o hook de panic) e delega para `desktop_lib::run()`, que é onde
//! o Tauri é montado de verdade (ver `lib.rs`).

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let log_file = desktop_lib::logging::init();

    #[cfg(target_os = "windows")]
    desktop_lib::run(log_file);

    #[cfg(not(target_os = "windows"))]
    drop(log_file);
}
