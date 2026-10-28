//! Os comandos da identidade (ADR 0013): entrar na API com a chave deste computador.
//!
//! A chave é calculada aqui dentro (`crate::identity`) e vai direto para a API (`crate::api`); o
//! JavaScript recebe só a sessão. Espelhados no `commands.ts` (`login`, `redeem`).
//!
//! Diferente dos outros comandos, a recusa do `login` e do `redeem` não é um `AppError`: é o
//! [`ApiError`], no formato do `apiFetch`, para o frontend tratar um login recusado igual a
//! qualquer chamada à API.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tracing::{error, warn};

use crate::api::{self, ApiError};
use crate::commands::run_blocking;
use crate::error::AppError;
use crate::identity::{self, marker, marker::AccountMarker};

/// A resposta do `login` e do `redeem` (`SessionResponse` em `api/src/routes/auth.rs`).
#[derive(Debug, Serialize, Deserialize)]
pub struct SessionResponse {
    pub token: String,
    /// O `UserView` da API, repassado sem um tipo do Rust no meio: um campo novo lá chega ao
    /// JavaScript (e ao tipo gerado) sem mudar nada aqui.
    pub user: serde_json::Value,
}

// Os pedidos levam a chave: sem `Debug`, para ela nunca ir parar num log por engano.
#[derive(Serialize)]
struct LoginRequest<'a> {
    device_key: &'a str,
}

#[derive(Serialize)]
struct RedeemRequest<'a> {
    code: &'a str,
    device_key: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    nick: Option<&'a str>,
}

/// Entra com a chave deste computador (`POST /api/auth/login`). Um computador sem conta recebe
/// `unknown_device`.
#[tauri::command]
pub async fn login(app: AppHandle) -> Result<SessionResponse, ApiError> {
    let device_key = device_key(&app).await?;
    let request = LoginRequest {
        device_key: &device_key,
    };
    let session: SessionResponse = api::post(&app, "/api/auth/login", &request).await?;
    remember_account(&app, &session).await;
    Ok(session)
}

/// Entra com um convite (`POST /api/auth/redeem`): cria a conta (convite novo, com `nick`) ou
/// liga este computador a uma conta que já existe (convite de recuperação, sem `nick`).
#[tauri::command]
pub async fn redeem(
    app: AppHandle,
    code: String,
    nick: Option<String>,
) -> Result<SessionResponse, ApiError> {
    let device_key = device_key(&app).await?;
    let request = RedeemRequest {
        code: &code,
        device_key: &device_key,
        nick: nick.as_deref(),
    };
    let session: SessionResponse = api::post(&app, "/api/auth/redeem", &request).await?;
    remember_account(&app, &session).await;
    Ok(session)
}

/// O marcador da conta (`identity/marker.rs`), ou `null` se nenhum login deu certo aqui.
#[tauri::command]
pub async fn account_marker(app: AppHandle) -> Result<Option<AccountMarker>, AppError> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Internal(error.to_string()))?;
    run_blocking(move || {
        marker::read(&data_dir)
            .map_err(|error| AppError::Internal(format!("marcador da conta: {error}")))
    })
    .await
}

/// Grava o marcador com o nick e o nome da sessão. Uma falha só vai para o log: a sessão vale do
/// mesmo jeito, e a próxima abertura tenta de novo.
async fn remember_account(app: &AppHandle, session: &SessionResponse) {
    let marker = match AccountMarker::deserialize(&session.user) {
        Ok(marker) => marker,
        Err(error) => {
            warn!(%error, "a sessão veio sem o nick para o marcador da conta");
            return;
        }
    };
    let data_dir = match app.path().app_data_dir() {
        Ok(dir) => dir,
        Err(error) => {
            warn!(%error, "sem a pasta de dados para o marcador da conta");
            return;
        }
    };
    let written = run_blocking(move || {
        marker::write(&data_dir, &marker).map_err(|error| AppError::Internal(error.to_string()))
    })
    .await;
    if let Err(error) = written {
        warn!(%error, "não foi possível gravar o marcador da conta");
    }
}

/// A chave, calculada fora da thread do comando (lê o firmware e o Gerenciador de Credenciais).
async fn device_key(app: &AppHandle) -> Result<String, ApiError> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || identity::device_key(&app))
        .await
        .map_err(|error| ApiError::app(format!("a tarefa em segundo plano falhou: {error}")))?
        .map_err(|error| {
            error!(%error, "não foi possível obter a chave do computador");
            ApiError::device_key()
        })
}
