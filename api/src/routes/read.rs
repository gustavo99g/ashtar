//! Rotas de lidas e silenciar (ADR 0022): marcar um canal como lido até uma
//! mensagem, marcar tudo como lido e silenciar um canal.
//!
//! As rotas de um canal passam pela regra de leitura, como as de mensagem: não
//! se marca nem se silencia o que não se pode ler. Toda mudança sai também
//! como `channel.state`, só para as conexões da própria pessoa.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::Deserialize;
use ts_rs::TS;

use super::auth::CurrentUser;
use super::extract::ApiJson;
use crate::AppState;
use crate::chat::access;
use crate::chat::read::{self, ReadState};
use crate::error::ApiError;
use crate::identity::User;
use crate::realtime::ServerEvent;

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct MarkReadRequest {
    /// A mensagem mais nova que a pessoa viu.
    pub message_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct MuteRequest {
    pub muted: bool,
}

/// Lê o estado de agora e manda para as conexões de `user`.
async fn publish_state(
    state: &AppState,
    user: &User,
    channel_id: &str,
) -> Result<ReadState, ApiError> {
    let read_state = read::state(&state.db, &user.id, channel_id).await?;
    state.hub.publish_to(
        &[&user.id],
        &ServerEvent::ChannelState {
            channel_id: channel_id.to_owned(),
            state: read_state.clone(),
        },
    );
    Ok(read_state)
}

/// `PUT /api/channels/{id}/read`: leva o ponteiro até `message_id` e devolve o
/// estado. O ponteiro não volta: com uma mensagem mais velha que a já lida, a
/// resposta é o estado de antes, e nenhum evento sai. 422 se a mensagem não é
/// desse canal.
pub async fn mark_read(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(channel_id): Path<String>,
    ApiJson(request): ApiJson<MarkReadRequest>,
) -> Result<Json<ReadState>, ApiError> {
    let channel = access::readable(&state.db, &user, &channel_id).await?;
    let moved = read::mark_read(&state.db, &user.id, channel.id(), &request.message_id).await?;
    let read_state = if moved {
        publish_state(&state, &user, channel.id()).await?
    } else {
        read::state(&state.db, &user.id, channel.id()).await?
    };
    Ok(Json(read_state))
}

/// `POST /api/read-all`: o "Marcar tudo como lido". Todo canal de texto e toda
/// conversa da pessoa vão para o fim; sai um `channel.state` de cada um que
/// mudou.
pub async fn mark_all_read(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<StatusCode, ApiError> {
    for channel_id in read::mark_all_read(&state.db, &user.id).await? {
        publish_state(&state, &user, &channel_id).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

/// `PUT /api/channels/{id}/mute`: silencia ou volta a ouvir, e devolve o
/// estado. Silenciar não mexe nas contagens: é o app que decide o que mostrar e
/// o que notificar (a menção passa por cima do silenciar).
pub async fn set_muted(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(channel_id): Path<String>,
    ApiJson(request): ApiJson<MuteRequest>,
) -> Result<Json<ReadState>, ApiError> {
    let channel = access::readable(&state.db, &user, &channel_id).await?;
    read::set_muted(&state.db, &user.id, channel.id(), request.muted).await?;
    Ok(Json(publish_state(&state, &user, channel.id()).await?))
}
