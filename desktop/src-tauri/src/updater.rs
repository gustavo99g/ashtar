//! Atualização automática (decisões 3 e 6 de `docs/plans/v0.2.0-base-de-entrega.md`).
//!
//! Só funciona no build de release: no desenvolvimento, [`spawn_periodic_check`]
//! e [`check_in_background`] não fazem nada. Verifica ao abrir e a cada 3
//! horas, baixa em segundo plano, confere a assinatura e guarda a versão
//! pronta em [`AutoUpdate`] até a pessoa clicar em "reiniciar"
//! ([`AutoUpdate::install_now`]) ou fechar o app
//! ([`AutoUpdate::install_on_exit`]). Nunca reinicia sozinho.
//!
//! O canal (estável ou beta) vem da API e fica só na memória (`channel.rs`,
//! ADR 0013): o [`AutoUpdate`] guarda o último e usa em toda verificação. A da
//! abertura vem antes do login e usa o estável (ou a variável).
//!
//! Não conhece nomes de evento do Tauri: avisa por `on_event` (os nomes e o
//! formato ficam em `commands/updater.rs`). Falha de rede é só log; falha de
//! assinatura ou de instalação vira [`UpdateEvent::Failed`].

mod channel;

use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use tauri::{AppHandle, Manager, Url};
use tauri_plugin_updater::{Error, Update, UpdaterExt};

pub use channel::Channel;

const STABLE_ENDPOINT: &str =
    "https://github.com/gustavo99g/ashtar-releases/releases/latest/download/latest.json";
const BETA_ENDPOINT: &str =
    "https://github.com/gustavo99g/ashtar-releases/releases/download/beta/latest.json";

const CHECK_INTERVAL: Duration = Duration::from_secs(3 * 60 * 60);

fn endpoint(channel: Channel) -> &'static str {
    match channel {
        Channel::Stable => STABLE_ENDPOINT,
        Channel::Beta => BETA_ENDPOINT,
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
    /// Uma verificação por vez: duas juntas (a periódica e a pedida pelo
    /// frontend) baixariam o mesmo instalador duas vezes. Um `Mutex` do tokio,
    /// que a verificação segura atravessando os `.await`.
    checking: tauri::async_runtime::Mutex<()>,
    /// O canal das verificações (ver `channel::resolve`).
    channel: Mutex<Channel>,
    /// `ASHTAR_UPDATE_CHANNEL`, lida uma vez ao abrir.
    env_channel: Option<String>,
}

impl AutoUpdate {
    /// Cria o estado. Até o primeiro `/api/me`, o canal é o da variável, ou o
    /// estável.
    pub fn new(on_event: impl Fn(UpdateEvent) + Send + Sync + 'static) -> Self {
        Self::with_env(on_event, std::env::var("ASHTAR_UPDATE_CHANNEL").ok())
    }

    fn with_env(
        on_event: impl Fn(UpdateEvent) + Send + Sync + 'static,
        env_channel: Option<String>,
    ) -> Self {
        let (channel, source) = channel::resolve(env_channel.as_deref(), None);
        tracing::info!(
            canal = channel.as_str(),
            origem = source.describe(),
            "canal de atualização"
        );

        Self {
            on_event: Box::new(on_event),
            ready: Mutex::new(None),
            checking: tauri::async_runtime::Mutex::new(()),
            channel: Mutex::new(channel),
            env_channel,
        }
    }

    /// Passa a usar nas próximas verificações o canal que a API mandou. Devolve
    /// `true` se elas acabaram de passar para o beta: aí vale verificar na hora,
    /// sem esperar as 3 horas.
    pub fn set_channel(&self, from_api: Channel) -> bool {
        let (next, source) = channel::resolve(self.env_channel.as_deref(), Some(from_api));
        let previous = std::mem::replace(
            &mut *self.channel.lock().unwrap_or_else(PoisonError::into_inner),
            next,
        );
        if previous != next {
            tracing::info!(
                canal = next.as_str(),
                origem = source.describe(),
                "canal de atualização mudou"
            );
        }
        previous == Channel::Stable && next == Channel::Beta
    }

    fn current_channel(&self) -> Channel {
        *self.channel.lock().unwrap_or_else(PoisonError::into_inner)
    }
    /// A versão já baixada, se houver.
    pub fn pending_version(&self) -> Option<String> {
        self.lock()
            .as_ref()
            .map(|ready| ready.update.version.clone())
    }
    /// Verifica, baixa e avisa. Se outra verificação estiver rodando, espera
    /// ela terminar e verifica de novo (uma versão que ela já baixou não é
    /// baixada outra vez).
    pub async fn check(&self, app: &AppHandle) {
        let _running = self.checking.lock().await;
        let result = self.check_and_download(app).await;

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
        let channel = self.current_channel();
        let endpoint = Url::parse(endpoint(channel)).expect("endpoint fixo é uma URL válida");

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

    fn auto_update(env: Option<&str>) -> AutoUpdate {
        AutoUpdate::with_env(|_| {}, env.map(str::to_owned))
    }

    #[test]
    fn abre_no_estavel_e_so_a_virada_para_o_beta_pede_verificacao() {
        let update = auto_update(None);
        assert_eq!(update.current_channel(), Channel::Stable);

        assert!(!update.set_channel(Channel::Stable));
        assert!(update.set_channel(Channel::Beta));
        assert_eq!(update.current_channel(), Channel::Beta);
        // Já no beta: não verifica de novo a cada /api/me.
        assert!(!update.set_channel(Channel::Beta));
        // Saiu do beta: o canal muda, mas não há o que baixar.
        assert!(!update.set_channel(Channel::Stable));
        assert_eq!(update.current_channel(), Channel::Stable);
    }

    #[test]
    fn a_variavel_de_desenvolvimento_vence_a_api() {
        let beta = auto_update(Some("beta"));
        assert_eq!(beta.current_channel(), Channel::Beta);
        assert!(!beta.set_channel(Channel::Stable));
        assert_eq!(beta.current_channel(), Channel::Beta);

        let stable = auto_update(Some("estavel"));
        assert!(!stable.set_channel(Channel::Beta));
        assert_eq!(stable.current_channel(), Channel::Stable);
    }

    #[test]
    fn cada_canal_tem_o_seu_endpoint() {
        assert!(endpoint(Channel::Stable).contains("/releases/latest/"));
        assert!(endpoint(Channel::Beta).contains("/releases/download/beta/"));
    }
}
