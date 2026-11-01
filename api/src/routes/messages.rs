//! Rotas do chat: o histórico de um canal e o envio.
//!
//! Todo membro ativo lê e escreve nos canais de texto que existem (ADR 0015).

use axum::Json;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use serde::Deserialize;
use ts_rs::TS;

use super::auth::CurrentUser;
use super::extract::ApiJson;
use crate::AppState;
use crate::chat::channels;
use crate::chat::messages::{
    self, CATCH_UP_MAX, Cursor, Message, MessagePage, PAGE_DEFAULT, PAGE_MAX,
};
use crate::db::now;
use crate::error::ApiError;

#[derive(Debug, Deserialize)]
pub struct PageQuery {
    pub before: Option<String>,
    pub after: Option<String>,
    pub limit: Option<i64>,
}

/// `GET /api/channels/{id}/messages`: sem nada, as 50 mais novas;
/// `?before=<id>`, as anteriores; `?after=<id>`, as que chegaram depois (até
/// 200, para a volta de uma reconexão). `limit` vai de 1 a 100.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Path(channel_id): Path<String>,
    query: Result<Query<PageQuery>, QueryRejection>,
) -> Result<Json<MessagePage>, ApiError> {
    let Query(query) = query
        .map_err(|_| ApiError::InvalidRequest("O pedido não está no formato esperado.".into()))?;
    let (cursor, max) = match (query.before, query.after) {
        (None, None) => (Cursor::Latest, PAGE_MAX),
        (Some(before), None) => (Cursor::Before(before), PAGE_MAX),
        (None, Some(after)) => (Cursor::After(after), CATCH_UP_MAX),
        (Some(_), Some(_)) => {
            return Err(ApiError::InvalidRequest(
                "Use before ou after, não os dois.".into(),
            ));
        }
    };
    let limit = match query.limit {
        None if matches!(cursor, Cursor::After(_)) => CATCH_UP_MAX,
        None => PAGE_DEFAULT,
        Some(limit) if (1..=max).contains(&limit) => limit,
        Some(_) => {
            return Err(ApiError::InvalidRequest(format!(
                "O limit vai de 1 a {max}."
            )));
        }
    };
    let channel = channels::get_open_text(&state.db, &channel_id).await?;
    Ok(Json(
        messages::page(&state.db, &channel, cursor, limit).await?,
    ))
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct SendMessageRequest {
    /// Gerado pelo app antes de enviar (um UUID); o mesmo valor não duplica.
    pub client_id: String,
    pub body: String,
}

/// `POST /api/channels/{id}/messages`: 201 com a mensagem nova, ou 200 com a
/// que já existia para esse `client_id` (409 se ela é de outro canal). As
/// regras e o limite de envio ficam no [`messages::create`].
pub async fn send(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(channel_id): Path<String>,
    ApiJson(request): ApiJson<SendMessageRequest>,
) -> Result<(StatusCode, Json<Message>), ApiError> {
    let channel = channels::get_open_text(&state.db, &channel_id).await?;
    let (message, created) = messages::create(
        &state.db,
        &state.send_limiter,
        &channel,
        &user,
        &request.client_id,
        &request.body,
        now(),
    )
    .await?;
    let status = if created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(message)))
}
