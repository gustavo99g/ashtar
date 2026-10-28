//! Extratores das rotas.

use axum::Json;
use axum::extract::{FromRequest, Request};
use serde::de::DeserializeOwned;

use crate::error::ApiError;

/// Como `axum::Json`, mas uma recusa (JSON quebrado, campo faltando, tipo
/// errado, sem `Content-Type`) volta no formato da API, `{ kind, message }`,
/// e não como texto puro. O app lê o corpo de erro como JSON.
pub struct ApiJson<T>(pub T);

impl<S, T> FromRequest<S> for ApiJson<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = ApiError;

    async fn from_request(request: Request, state: &S) -> Result<Self, ApiError> {
        match Json::<T>::from_request(request, state).await {
            Ok(Json(value)) => Ok(Self(value)),
            Err(_) => Err(ApiError::InvalidRequest(
                "O pedido não está no formato esperado.".into(),
            )),
        }
    }
}
