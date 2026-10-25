//! Os comandos da identidade (ADR 0013): entrar na API com a chave deste computador.
//!
//! A chave é calculada aqui dentro (`crate::identity`) e vai direto para a API (`crate::api`); o
//! JavaScript recebe só a sessão. Espelhados no `commands.ts` (`login`, `redeem`).
//!
//! Diferente dos outros comandos, a recusa não é um `AppError`: é o [`ApiError`], no formato do
//! `apiFetch`, para o frontend tratar um login recusado igual a qualquer chamada à API.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tracing::error;

use crate::api::{self, ApiError};
use crate::identity;

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
    api::post(&app, "/api/auth/login", &request).await
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
    api::post(&app, "/api/auth/redeem", &request).await
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
