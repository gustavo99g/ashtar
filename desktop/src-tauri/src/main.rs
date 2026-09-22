// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn init_tracing() {
    use tracing_subscriber::{fmt, EnvFilter};

    let default = if cfg!(debug_assertions) {
        "info,desktop=debug"
    } else {
        "info"
    };
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default));

    fmt().with_env_filter(filter).with_thread_names(true).init();

    std::panic::set_hook(Box::new(|info| {
        let thread = std::thread::current();
        let thread_name = thread.name().unwrap_or("sem nome");

        let location = info
            .location()
            .map(|location| location.to_string())
            .unwrap_or_else(|| "local desconhecido".to_string());

        // Threads de captura (vídeo/áudio) rodam soltas: sem este hook um
        // panic nelas mata a thread em silêncio e o app segue achando que
        // a captura está ativa. Toda thread criada no projeto deve ser
        // nomeada via `thread::Builder::new().name("...")` para que este
        // log seja útil.
        tracing::error!(thread = thread_name, %location, "panic: {info}");
    }));
}

fn main() {
    init_tracing();

    #[cfg(target_os = "windows")]
    desktop_lib::run();
}
