//! Logs do app: terminal e arquivo diário (decisão 10 do `PLAN.md`).
//!
//! [`init`] roda no início do `main`, antes do Tauri: instala o subscriber
//! global e o hook de panic. A pasta de logs só é conhecida no `setup`
//! (`app_log_dir`), então o arquivo entra depois, por [`attach_file`]. Até
//! lá, as linhas do arquivo são descartadas; o terminal recebe tudo desde o
//! início.
//!
//! Regras:
//!
//! - o `WorkerGuard` do arquivo fica no estado do Tauri ([`LogGuard`]) e é
//!   solto por [`flush`] ao fechar o app. O Tauri encerra o processo sem
//!   rodar os destrutores do estado; sem o `flush`, as últimas linhas se
//!   perdem;
//! - toda thread criada no projeto deve ter nome (`thread::Builder::name`),
//!   que aparece em cada linha e no log de panic.

use std::io;
use std::sync::{Arc, Mutex, OnceLock, PoisonError};

use tauri::{AppHandle, Manager};
use tracing_appender::non_blocking::{NonBlocking, WorkerGuard};
use tracing_appender::rolling::{Builder, Rotation};
use tracing_subscriber::fmt::writer::{EitherWriter, MakeWriter};
use tracing_subscriber::prelude::*;
use tracing_subscriber::{fmt, EnvFilter};

/// Os arquivos ficam como `ashtar.2026-10-07.log`.
const FILE_PREFIX: &str = "ashtar";
const FILE_SUFFIX: &str = "log";
/// Arquivos mais antigos que os 7 últimos são apagados na rotação.
const KEEP_FILES: usize = 7;

/// Escritor do arquivo de log que só passa a gravar depois de [`attach_file`].
///
/// É um `Arc`: o subscriber guarda uma cópia e o `main` passa outra ao `run`,
/// e as duas apontam para o mesmo `OnceLock`.
#[derive(Clone, Default)]
pub struct LateFile(Arc<OnceLock<NonBlocking>>);

impl<'a> MakeWriter<'a> for LateFile {
    type Writer = EitherWriter<NonBlocking, io::Sink>;

    fn make_writer(&'a self) -> Self::Writer {
        match self.0.get() {
            Some(file) => EitherWriter::A(file.clone()),
            None => EitherWriter::B(io::sink()),
        }
    }
}

/// O guard do escritor em segundo plano. Soltá-lo descarrega o que falta.
pub struct LogGuard(Mutex<Option<WorkerGuard>>);

/// Instala o subscriber global (terminal + arquivo tardio) e o hook de panic.
///
/// Chamar uma vez, no início do `main`. Devolve o escritor do arquivo, que o
/// `setup` liga com [`attach_file`].
pub fn init() -> LateFile {
    let file = LateFile::default();

    tracing_subscriber::registry()
        .with(env_filter())
        .with(fmt::layer().with_thread_names(true))
        .with(
            fmt::layer()
                .with_thread_names(true)
                .with_ansi(false)
                .with_writer(file.clone()),
        )
        .init();

    install_panic_hook();
    file
}

/// Liga o arquivo de log na pasta de logs do app e guarda o guard no estado.
///
/// Chamar no `setup`. Uma segunda chamada não faz nada.
pub fn attach_file(app: &AppHandle, file: &LateFile) -> Result<(), Box<dyn std::error::Error>> {
    let dir = app.path().app_log_dir()?;

    let appender = Builder::new()
        .rotation(Rotation::DAILY)
        .filename_prefix(FILE_PREFIX)
        .filename_suffix(FILE_SUFFIX)
        .max_log_files(KEEP_FILES)
        .build(&dir)?;

    let (writer, guard) = tracing_appender::non_blocking(appender);

    if file.0.set(writer).is_err() {
        return Ok(());
    }

    app.manage(LogGuard(Mutex::new(Some(guard))));

    tracing::info!(
        version = %app.package_info().version,
        dir = %dir.display(),
        "logs em arquivo"
    );

    Ok(())
}

/// Descarrega o arquivo de log. Chamar antes de o processo terminar.
///
/// Depois disso, linhas novas ainda entram na fila, mas não há garantia de que
/// cheguem ao arquivo.
pub fn flush(app: &AppHandle) {
    if let Some(guard) = app.try_state::<LogGuard>() {
        let guard = guard
            .0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        drop(guard);
    }
}

fn env_filter() -> EnvFilter {
    // O crate da lib se chama `desktop_lib` (veja `[lib] name` no Cargo.toml),
    // não `desktop` — é onde vive praticamente todo o código (commands/, media/
    // etc). O binário em si (`main.rs`) usa o target `ashtar`.

    let default = if cfg!(debug_assertions) {
        "info,ashtar=debug,desktop_lib=debug"
    } else {
        "info"
    };
    // Não usar `EnvFilter::try_from_default_env()` puro: se `RUST_LOG`
    // estiver definida porém vazia (comum quando alguma ferramenta do
    // ambiente exporta a variável sem valor), ele retorna `Ok` com um
    // filtro vazio, que suprime literalmente todo log — inclusive
    // `error!` — e o fallback abaixo nunca é acionado porque não houve
    // `Err`. Por isso tratamos "ausente ou vazia" como o mesmo caso.
    match std::env::var("RUST_LOG") {
        Ok(value) if !value.trim().is_empty() => EnvFilter::new(value),
        _ => EnvFilter::new(default),
    }
}

fn install_panic_hook() {
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
