//! Erros das regras de identidade e como cada um vira resposta HTTP.
//!
//! O corpo segue o formato do `client_policy`: `{ kind, message }`, com a
//! mensagem pronta para mostrar à pessoa. O `admin` mostra só a mensagem.

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("Sessão inválida. Entre de novo.")]
    Unauthenticated,
    #[error("Este computador não está vinculado a nenhum membro.")]
    UnknownDevice,
    #[error("Você não tem permissão para isso.")]
    Forbidden,
    #[error("Convite inválido, expirado ou já usado.")]
    InvalidInvite,
    #[error("{0}")]
    InvalidNick(&'static str),
    #[error("Esse nick já está em uso.")]
    NickTaken,
    #[error("Chave do dispositivo inválida.")]
    InvalidDeviceKey,
    #[error("Este computador já está vinculado a um membro.")]
    DeviceAlreadyLinked,
    /// Dado de entrada fora do que a regra aceita (tamanho, faixa, combinação).
    #[error("{0}")]
    InvalidRequest(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("Muitas tentativas. Espere alguns minutos e tente de novo.")]
    TooManyAttempts,
    #[error("Erro interno no servidor.")]
    Internal(#[from] sqlx::Error),
    /// Falta configuração no servidor (uma variável do `.env`, por exemplo).
    #[error("Erro interno no servidor.")]
    Config(String),
}

impl ApiError {
    fn status_and_kind(&self) -> (StatusCode, &'static str) {
        match self {
            Self::Unauthenticated => (StatusCode::UNAUTHORIZED, "unauthenticated"),
            Self::UnknownDevice => (StatusCode::UNAUTHORIZED, "unknown_device"),
            Self::Forbidden => (StatusCode::FORBIDDEN, "forbidden"),
            Self::InvalidInvite => (StatusCode::BAD_REQUEST, "invalid_invite"),
            Self::InvalidNick(_) => (StatusCode::UNPROCESSABLE_ENTITY, "invalid_nick"),
            Self::NickTaken => (StatusCode::CONFLICT, "nick_taken"),
            Self::InvalidDeviceKey => (StatusCode::UNPROCESSABLE_ENTITY, "invalid_device_key"),
            Self::DeviceAlreadyLinked => (StatusCode::CONFLICT, "device_already_linked"),
            Self::InvalidRequest(_) => (StatusCode::UNPROCESSABLE_ENTITY, "invalid_request"),
            Self::NotFound(_) => (StatusCode::NOT_FOUND, "not_found"),
            Self::Conflict(_) => (StatusCode::CONFLICT, "conflict"),
            Self::TooManyAttempts => (StatusCode::TOO_MANY_REQUESTS, "too_many_attempts"),
            Self::Internal(_) | Self::Config(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal"),
        }
    }
}

/// A violação de um índice único do SQLite, se `error` for uma. Devolve a
/// mensagem do banco (`UNIQUE constraint failed: ...`), para quem chama
/// decidir qual erro de regra ela significa.
pub(crate) fn unique_violation(error: &sqlx::Error) -> Option<&str> {
    match error {
        sqlx::Error::Database(db) if db.is_unique_violation() => Some(db.message()),
        _ => None,
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        match &self {
            Self::Internal(error) => eprintln!("erro interno: {error}"),
            Self::Config(message) => eprintln!("configuração: {message}"),
            _ => {}
        }
        let (status, kind) = self.status_and_kind();
        let body = json!({ "kind": kind, "message": self.to_string() });
        (status, Json(body)).into_response()
    }
}
