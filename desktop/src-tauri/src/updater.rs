//! Atualização automática (decisões 3 e 6 do `PLAN.md` da v0.2.0).
//!
//! Só funciona no build de release: no desenvolvimento, [`spawn_periodic_check`]
//! e [`check_in_background`] não fazem nada. Verifica ao abrir e a cada 3
//! horas, baixa em segundo plano, confere a assinatura e guarda a versão
//! pronta em [`AutoUpdate`] até a pessoa clicar em "reiniciar"
//! ([`AutoUpdate::install_now`]) ou fechar o app
//! ([`AutoUpdate::install_on_exit`]). Nunca reinicia sozinho.
//!
//! Não conhece nomes de evento do Tauri: avisa por `on_event` (os nomes e o
//! formato ficam em `commands/updater.rs`). Falha de rede é só log; falha de
//! assinatura ou de instalação vira [`UpdateEvent::Failed`].
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use tauri::{AppHandle, Manager, Url};
use tauri_plugin_updater::{Error, Update, UpdaterExt};

const STABLE_ENDPOINT: &str =
    "https://github.com/gustavo99g/ashtar-releases/releases/latest/download/latest.json";
const BETA_ENDPOINT: &str =
    "https://github.com/gustavo99g/ashtar-releases/releases/download/beta/latest.json";

const CHECK_INTERVAL: Duration = Duration::from_secs(3 * 60 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    Stable,
    Beta,
}

impl Channel {
    /// Lê `ASHTAR_UPDATE_CHANNEL`. Até a v0.2.2, é o único jeito de entrar no
    /// beta; na v0.2.2 o canal passa a vir da API.
    pub fn from_env() -> Self {
        Self::parse(std::env::var("ASHTAR_UPDATE_CHANNEL").ok().as_deref())
    }
    /// Só `beta` (sem diferenciar maiúsculas) liga o beta; o resto é estável.
    fn parse(value: Option<&str>) -> Self {
        match value {
            Some(value) if value.trim().eq_ignore_ascii_case("beta") => Self::Beta,
            _ => Self::Stable,
        }
    }

    fn endpoint(self) -> &'static str {
        match self {
            Self::Stable => STABLE_ENDPOINT,
            Self::Beta => BETA_ENDPOINT,
        }
    }
}

/// O que o frontend precisa saber.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateEvent {
    /// Uma versão foi baixada e conferida; falta reiniciar.
    Ready { version: String },
    /// A assinatura não confere, o manifesto está errado, ou a instalação falhou.
    Failed { message: String },
}

/// Uma versão baixada e com a assinatura conferida.
struct ReadyUpdate {
    update: Update,
    bytes: Vec<u8>,
}
/// Estado da atualização, gerenciado pelo Tauri (`app.manage`).
pub struct AutoUpdate {
    on_event: Box<dyn Fn(UpdateEvent) + Send + Sync>,
    ready: Mutex<Option<ReadyUpdate>>,
    /// Impede duas verificações ao mesmo tempo (a periódica e a pedida pelo
    /// frontend), que baixariam o mesmo instalador duas vezes.
    checking: AtomicBool,
}

impl AutoUpdate {
    pub fn new(on_event: impl Fn(UpdateEvent) + Send + Sync + 'static) -> Self {
        Self {
            on_event: Box::new(on_event),
            ready: Mutex::new(None),
            checking: AtomicBool::new(false),
        }
    }
    /// A versão já baixada, se houver.
    pub fn pending_version(&self) -> Option<String> {
        self.lock()
            .as_ref()
            .map(|ready| ready.update.version.clone())
    }
    /// Verifica, baixa e avisa. Se outra verificação estiver rodando, não faz nada.
    pub async fn check(&self, app: &AppHandle) {
        if self.checking.swap(true, Ordering::AcqRel) {
            return;
        }
        let result = self.check_and_download(app).await;
        self.checking.store(false, Ordering::Release);

        match result {
            Ok(Some(version)) => (self.on_event)(UpdateEvent::Ready { version }),
            Ok(None) => {}
            Err(error) if is_network(&error) => {
                tracing::warn!(%error, "não foi possivel verificar se há atualização");
            }
            Err(error) => {
                tracing::error!(%error, "falha na atualização");
                (self.on_event)(UpdateEvent::Failed {
                    message: error.to_string(),
                })
            }
        }
    }
    /// Devolve a versão baixada agora, ou `None` se não havia nada novo.
    async fn check_and_download(&self, app: &AppHandle) -> Result<Option<String>, Error> {
        let channel = Channel::from_env();
        let endpoint = Url::parse(channel.endpoint()).expect("endpoint fixo é uma URL válida");

        // O instalador encerra o processo com `exit`: os logs precisam ser descarregados antes (ver `logging::flush`).
        let flush_app = app.clone();
        let updater = app
            .updater_builder()
            .endpoints(vec![endpoint])?
            .on_before_exit(move || crate::logging::flush(&flush_app))
            .build()?;

        let Some(update) = updater.check().await? else {
            tracing::debug!(?channel, "nenhuma versão nova");
            return Ok(None);
        };

        if self.pending_version().as_deref() == Some(update.version.as_str()) {
            return Ok(None);
        }
        tracing::info!(version = %update.version, ?channel, "baixando atualização");
        let bytes = update.download(|_, _| {}, || {}).await?;
        let version = update.version.clone();
        *self.lock() = Some(ReadyUpdate { update, bytes });

        tracing::info!(%version, "atualização pronta");

        Ok(Some(version))
    }

    /// Instala a versão baixada e reabre o app.
    ///
    /// Se der certo, **não volta**: o processo termina. `Ok(false)` se não
    /// havia nada baixado.
    ///
    /// # Bloqueia
    ///
    /// Grava o instalador numa pasta temporária antes de abri-lo.
    pub fn install_now(&self) -> Result<bool, Error> {
        let Some(ready) = self.lock().take() else {
            return Ok(false);
        };

        tracing::info!(version = %ready.update.version, "instalando atualização (reinicia o app)");
        if let Err(error) = ready.update.install(&ready.bytes) {
            // Devolve a versão para uma nova tentativa.
            *self.lock() = Some(ready);
            return Err(error);
        }
        Ok(true)
    }

    /// Ao fechar o app: instala a versão baixada, se houver, sem reabrir.
    ///
    /// # Bloqueia
    ///
    /// Como [`install_now`](Self::install_now). Se houver versão, não volta.
    pub fn install_on_exit(&self) {
        let Some(ready) = self.lock().take() else {
            return;
        };

        tracing::info!(version = %ready.update.version, "instalando atualização ao fechar");
        let update = ready.update.restart_after_install(false);
        if let Err(error) = update.install(&ready.bytes) {
            tracing::error!(%error, "não foi possível instalar a atualização ao fechar");
        }
    }
    fn lock(&self) -> MutexGuard<'_, Option<ReadyUpdate>> {
        self.ready.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Falhas que só significam "não deu para falar com o GitHub agora".
fn is_network(error: &Error) -> bool {
    matches!(
        error,
        Error::Reqwest(_) | Error::Network(_) | Error::ReleaseNotFound
    )
}
/// Verifica agora e depois a cada 3 horas, enquanto o app estiver aberto.
/// Não faz nada no desenvolvimento.
pub fn spawn_periodic_check(app: AppHandle) {
    if cfg!(debug_assertions) {
        tracing::debug!("atualização automática desligada no desenvolvimento");
        return;
    }
    tauri::async_runtime::spawn(async move {
        loop {
            app.state::<AutoUpdate>().check(&app).await;
            tokio::time::sleep(CHECK_INTERVAL).await
        }
    });
}

/// Uma verificação avulsa, sem esperar o resultado (ele chega por `on_event`).
/// Não faz nada no desenvolvimento.
pub fn check_in_background(app: AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }

    tauri::async_runtime::spawn(async move {
        app.state::<AutoUpdate>().check(&app).await;
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn so_beta_liga_o_canal_beta() {
        assert_eq!(Channel::parse(None), Channel::Stable);
        assert_eq!(Channel::parse(Some("")), Channel::Stable);
        assert_eq!(Channel::parse(Some("estavel")), Channel::Stable);
        assert_eq!(Channel::parse(Some("beta")), Channel::Beta);
        assert_eq!(Channel::parse(Some(" BETA ")), Channel::Beta);
    }

    #[test]
    fn cada_canal_tem_o_seu_endpoint() {
        assert!(Channel::Stable.endpoint().contains("/releases/latest/"));
        assert!(Channel::Beta
            .endpoint()
            .contains("/releases/download/beta/"));
    }
}
