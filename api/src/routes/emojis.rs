//! Rotas dos emojis do grupo (decisão 31 do plano da v0.7). Ler, todo mundo; o resto, quem tem
//! "Gerenciar emojis". Cada mudança manda a lista inteira no `emojis.changed`.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;

use super::auth::CurrentUser;
use super::extract::ApiJson;
use crate::AppState;
use crate::chat::emojis::{self, CreateEmojiRequest, Emoji, RenameEmojiRequest};
use crate::db::now;
use crate::error::ApiError;
use crate::realtime::ServerEvent;

async fn publish(state: &AppState) -> Result<(), ApiError> {
    let emojis = emojis::list(&state.db).await?;
    state.hub.publish(&ServerEvent::EmojisChanged { emojis });
    Ok(())
}

/// `GET /api/emojis`: todos, por nome.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
) -> Result<Json<Vec<Emoji>>, ApiError> {
    Ok(Json(emojis::list(&state.db).await?))
}

/// `POST /api/emojis`: o nome repetido e o 101º são 409.
pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(request): ApiJson<CreateEmojiRequest>,
) -> Result<(StatusCode, Json<Emoji>), ApiError> {
    let emoji = emojis::create(&state.db, &user, &request, now()).await?;
    publish(&state).await?;
    Ok((StatusCode::CREATED, Json(emoji)))
}

/// `PATCH /api/emojis/{id}`: troca o nome.
pub async fn rename(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(request): ApiJson<RenameEmojiRequest>,
) -> Result<StatusCode, ApiError> {
    emojis::rename(&state.db, &user, &id, &request).await?;
    publish(&state).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// `DELETE /api/emojis/{id}`: sai o emoji, as reações com ele e o arquivo.
pub async fn delete(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let file_id = emojis::delete(&state.db, &user, &id).await?;
    if let Err(error) = state.files.delete(&file_id).await {
        eprintln!("emoji {file_id}: não deu para apagar do disco: {error}");
    }
    publish(&state).await?;
    Ok(StatusCode::NO_CONTENT)
}
