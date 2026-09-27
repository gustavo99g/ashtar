//! Binário do app desktop. Só inicializa observabilidade (`init_tracing`,
//! incluindo o hook de panic) e delega para `desktop_lib::run()`, que é onde
//! o Tauri é montado de verdade (ver `lib.rs`).

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn init_tracing() {
    use tracing_subscriber::{fmt, EnvFilter};

    // O crate da lib se chama `desktop_lib` (veja `[lib] name` no Cargo.toml),
    // não `desktop` — é onde vive praticamente todo o código (legacy/, media/
    // etc). O binário em si (`main.rs`) usa o target `desktop`.
    let default = if cfg!(debug_assertions) {
        "info,desktop=debug,desktop_lib=debug"
    } else {
        "info"
    };

    // Não usar `EnvFilter::try_from_default_env()` puro: se `RUST_LOG`
    // estiver definida porém vazia (comum quando alguma ferramenta do
    // ambiente exporta a variável sem valor), ele retorna `Ok` com um
    // filtro vazio, que suprime literalmente todo log — inclusive
    // `error!` — e o fallback abaixo nunca é acionado porque não houve
    // `Err`. Por isso tratamos "ausente ou vazia" como o mesmo caso.
    let filter = match std::env::var("RUST_LOG") {
        Ok(value) if !value.trim().is_empty() => EnvFilter::new(value),
        _ => EnvFilter::new(default),
    };

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
