//! Rotas dos canais e das categorias: a lista, os arquivados, criar, editar,
//! arquivar, desarquivar e reordenar (ADR 0016).
//!
//! Ler a lista é de todo membro. Mudar é de quem tem "Gerenciar canais"
//! (`canais.gerenciar`; o dono sempre tem), conferido nas regras de `chat/`.
//! Toda mudança publica o `channels.changed` com a versão que a própria
//! transação gravou, e os apps recarregam a lista.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::Deserialize;
use ts_rs::TS;

use super::auth::CurrentUser;
use super::extract::ApiJson;
use crate::AppState;
use crate::chat::categories;
use crate::chat::channels::{self, ChannelEdit, ChannelKind, ChannelView};
use crate::chat::layout::{self, Archived, Layout, LayoutRequest};
use crate::db::now;
use crate::error::ApiError;
use crate::realtime::ServerEvent;
use crate::voice;

/// Avisa todo mundo que a lista mudou. `None` é a repetição que não mudou nada
/// (arquivar o que já estava arquivado): não há o que avisar.
fn changed(state: &AppState, version: Option<i64>) {
    if let Some(version) = version {
        state.hub.publish(&ServerEvent::ChannelsChanged { version });
    }
}

/// `GET /api/channels`.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
) -> Result<Json<Layout>, ApiError> {
    Ok(Json(layout::read(&state.db).await?))
}

/// `GET /api/channels/archived`: só de quem gerencia.
pub async fn archived(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Archived>, ApiError> {
    Ok(Json(layout::read_archived(&state.db, &user).await?))
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct CreateChannelRequest {
    /// `text` (o padrão) ou `voice`.
    #[serde(default)]
    #[ts(optional)]
    pub kind: Option<ChannelKind>,
    pub name: String,
    /// Sem categoria, o canal vai para o fim do topo.
    #[serde(default)]
    #[ts(optional)]
    pub category_id: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub topic: Option<String>,
}

/// `POST /api/channels`: um canal de texto ou uma sala de voz nova.
pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(request): ApiJson<CreateChannelRequest>,
) -> Result<(StatusCode, Json<ChannelView>), ApiError> {
    let (channel, version) = channels::create(
        &state.db,
        &user,
        request.kind.unwrap_or(ChannelKind::Text),
        &request.name,
        request.category_id.as_deref(),
        request.topic.as_deref(),
        now(),
    )
    .await?;
    changed(&state, Some(version));
    Ok((StatusCode::CREATED, Json(channel.into())))
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct UpdateChannelRequest {
    #[serde(default)]
    #[ts(optional)]
    pub name: Option<String>,
    /// Texto vazio tira o tópico; ausente deixa como está.
    #[serde(default)]
    #[ts(optional)]
    pub topic: Option<String>,
}

/// `PATCH /api/channels/{id}`: nome e tópico.
pub async fn update(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(request): ApiJson<UpdateChannelRequest>,
) -> Result<Json<ChannelView>, ApiError> {
    let edit = ChannelEdit {
        name: request.name.as_deref(),
        topic: request.topic.as_deref(),
    };
    let (channel, version) = channels::update(&state.db, &user, &id, edit).await?;
    changed(&state, version);
    Ok(Json(channel.into()))
}

/// `POST /api/channels/{id}/archive`. Arquivar uma sala de voz com gente dentro
/// apaga a sala no LiveKit, o que tira todo mundo dela (ADR 0026): o app vê a
/// sala sumir e mostra "A sala foi arquivada".
pub async fn archive(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let voice_room = channels::get_open_voice(&state.db, &id).await.is_ok();
    let version = channels::archive(&state.db, &user, &id, now()).await?;
    if voice_room && version.is_some() {
        voice::delete_room_in_background(id);
    }
    changed(&state, version);
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/channels/{id}/unarchive`.
pub async fn unarchive(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let version = channels::unarchive(&state.db, &user, &id).await?;
    changed(&state, version);
    Ok(StatusCode::NO_CONTENT)
}

/// `PUT /api/channels/layout`: a ordem nova. 409 se a versão já mudou.
pub async fn set_layout(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(request): ApiJson<LayoutRequest>,
) -> Result<Json<Layout>, ApiError> {
    let layout = layout::apply(&state.db, &user, &request).await?;
    changed(&state, Some(layout.version));
    Ok(Json(layout))
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct CategoryRequest {
    pub name: String,
}

/// `POST /api/categories`: devolve a lista inteira, já com a categoria nova.
pub async fn create_category(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(request): ApiJson<CategoryRequest>,
) -> Result<(StatusCode, Json<Layout>), ApiError> {
    let (_, version) = categories::create(&state.db, &user, &request.name, now()).await?;
    changed(&state, Some(version));
    Ok((StatusCode::CREATED, Json(layout::read(&state.db).await?)))
}

/// `PATCH /api/categories/{id}`: o nome.
pub async fn rename_category(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(request): ApiJson<CategoryRequest>,
) -> Result<StatusCode, ApiError> {
    let (_, version) = categories::rename(&state.db, &user, &id, &request.name).await?;
    changed(&state, version);
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/categories/{id}/archive`: os canais dela vão para o topo.
pub async fn archive_category(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let version = categories::archive(&state.db, &user, &id, now()).await?;
    changed(&state, version);
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/categories/{id}/unarchive`.
pub async fn unarchive_category(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let version = categories::unarchive(&state.db, &user, &id).await?;
    changed(&state, version);
    Ok(StatusCode::NO_CONTENT)
}
