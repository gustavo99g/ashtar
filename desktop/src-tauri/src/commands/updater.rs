//! Comandos e eventos da atualização automática (Etapa 4 da v0.2.0).
//!
//! A lógica mora em `crate::updater`; aqui ficam só os nomes e o formato do
//! que o frontend vê, espelhados no `commands.ts`.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tracing::warn;

use crate::{
    commands::run_blocking,
    error::AppError,
    updater::{self, AutoUpdate, Channel, UpdateEvent},
};

pub const UPDATE_READY: &str = "update-ready";
pub const UPDATE_FAILED: &str = "update-failed";

#[derive(Debug, Clone, Serialize)]
pub struct UpdateReadyPayload {
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdateFailedPayload {
    pub message: String,
}

/// Cria o estado da atualização, ligado aos eventos do Tauri.
/// Chamado uma vez, no `setup` do app.
pub fn create_auto_update(app: &AppHandle) -> AutoUpdate {
    let app = app.clone();
    AutoUpdate::new(move |event| {
        let result = match event {
            UpdateEvent::Ready { version } => {
                app.emit(UPDATE_READY, UpdateReadyPayload { version })
            }
            UpdateEvent::Failed { message } => {
                app.emit(UPDATE_FAILED, UpdateFailedPayload { message })
            }
        };

        if let Err(error) = result {
            warn!(%error, "falha ao emitir evento de atualização para o frontend");
        }
    })
}
/// A versão já baixada esperando o "reiniciar", se houver. Cobre o caso de a
/// versão ficar pronta antes de o frontend começar a escutar os eventos.
#[tauri::command]
pub async fn pending_update(app: AppHandle) -> Result<Option<String>, AppError> {
    Ok(app.state::<AutoUpdate>().pending_version())
}

/// Instala a versão baixada e reinicia o app. Se der certo, a Promise nunca
/// resolve: o processo termina.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), AppError> {
    run_blocking(move || match app.state::<AutoUpdate>().install_now() {
        Ok(true) => Ok(()),
        Ok(false) => Err(AppError::Update("nenhuma atualização pronta".into())),
        Err(error) => Err(AppError::Update(error.to_string())),
    })
    .await
}

/// Pede uma verificação agora (usado quando a API responde 426, Etapa 6).
/// Não espera: o resultado chega pelos eventos.
#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<(), AppError> {
    updater::check_in_background(app);
    Ok(())
}

/// Passa ao updater o canal de atualização que a API mandou (`update_channel`
/// do `/api/me`, ADR 0013). Fica só na memória. Se as verificações passaram
/// para o beta agora, verifica na hora.
#[tauri::command]
pub async fn set_update_channel(app: AppHandle, channel: Channel) -> Result<(), AppError> {
    let switched_to_beta = app.state::<AutoUpdate>().set_channel(channel);
    if switched_to_beta {
        updater::check_in_background(app);
    }
    Ok(())
}
