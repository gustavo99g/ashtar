//! Rotas do chat: o histórico de um canal e o envio.
//!
//! Todo membro ativo lê e escreve nos canais de texto que existem (ADR 0015),
//! e cada conversa privada é só das duas pessoas dela (ADR 0021). Quem decide é
//! a regra de leitura, [`access::readable`], e as duas rotas passam por ela.

use axum::Json;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use serde::Deserialize;
use ts_rs::TS;

use super::auth::CurrentUser;
use super::extract::ApiJson;
use crate::AppState;
use crate::chat::access::{self, Readable};
use crate::chat::messages::{
    self, CATCH_UP_MAX, Cursor, Message, MessagePage, PAGE_DEFAULT, PAGE_MAX,
};
use crate::db::now;
use crate::error::ApiError;
use crate::identity::users;
use crate::realtime::ServerEvent;

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
    CurrentUser(user): CurrentUser,
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
    let channel = access::readable(&state.db, &user, &channel_id).await?;
    Ok(Json(
        messages::page(&state.db, channel.id(), cursor, limit).await?,
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
/// regras e o limite de envio ficam no [`messages::create`]. Numa conversa
/// privada com quem saiu do grupo, 409.
pub async fn send(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(channel_id): Path<String>,
    ApiJson(request): ApiJson<SendMessageRequest>,
) -> Result<(StatusCode, Json<Message>), ApiError> {
    let channel = access::readable(&state.db, &user, &channel_id).await?;
    if let Readable::Dm(dm) = &channel {
        // A conversa com quem saiu do grupo continua na lista, só para leitura.
        let other = users::get_by_id(&state.db, dm.other(&user.id)).await?;
        if !other.is_active() {
            return Err(ApiError::Conflict("Essa pessoa saiu do grupo.".into()));
        }
    }
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
        // Só a nova vai para o WebSocket: a repetida quem devia já recebeu.
        // A de um canal de texto vai para quem acessa o canal (todos, se ele
        // não é restrito); a de uma conversa privada, só para os dois.
        let event = ServerEvent::MessageCreated {
            message: message.clone(),
        };
        match &channel {
            Readable::Text(text) => {
                let to = access::audience(&state.db, &text.id).await?;
                state.hub.publish_in(&event, to);
            }
            Readable::Dm(dm) => state.hub.publish_to(&dm.members, &event),
        }
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(message)))
}
