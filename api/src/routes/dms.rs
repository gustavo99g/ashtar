//! Rotas das conversas privadas (ADR 0021): abrir uma e listar as suas.
//!
//! Ler e enviar ficam nas rotas de mensagem de sempre
//! (`/api/channels/{id}/messages`), com o `id` da conversa.

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::Deserialize;
use ts_rs::TS;

use super::auth::CurrentUser;
use super::extract::ApiJson;
use crate::AppState;
use crate::chat::dms::{self, Conversation};
use crate::db::now;
use crate::error::ApiError;

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct OpenDmRequest {
    /// O id da outra pessoa.
    pub user_id: String,
}

/// `POST /api/dms`: abre a conversa com `user_id`. 201 na primeira vez, 200 com
/// a mesma conversa nas seguintes, de qualquer um dos dois lados. 422 consigo
/// mesmo, 404 com quem não está no grupo.
///
/// Abrir não avisa ninguém: a conversa só aparece para a outra pessoa quando
/// tiver uma mensagem.
pub async fn open(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(request): ApiJson<OpenDmRequest>,
) -> Result<(StatusCode, Json<Conversation>), ApiError> {
    let (dm, created) = dms::open(&state.db, &user, &request.user_id, now()).await?;
    let status = if created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(dms::view(&state.db, &dm, &user).await?)))
}

/// `GET /api/dms`: as conversas de quem pede que têm pelo menos uma mensagem,
/// da que andou por último para a mais parada.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<Conversation>>, ApiError> {
    Ok(Json(dms::list(&state.db, &user).await?))
}
