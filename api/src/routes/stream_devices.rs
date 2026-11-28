//! Rotas dos aparelhos de transmissão (ADR 0038).
//!
//! Do lado do app (sessão do computador, [`CurrentUser`]): gerar o código de pareamento, listar,
//! renomear e desvincular os aparelhos. Do lado do aparelho: trocar o código pela sessão dele
//! (sem sessão, com o limite de tentativas) e, com a sessão dele ([`CurrentStreamDevice`]), saber
//! para onde a tela vai e pedir o token dela.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::auth::{CurrentStreamDevice, CurrentUser, UserView};
use super::extract::ApiJson;
use super::voice::{JoinVoiceResponse, check_room, issue_screen_token};
use crate::AppState;
use crate::calls::{self, CallOutcome};
use crate::chat::{channels, dms};
use crate::db::now;
use crate::error::ApiError;
use crate::identity::permissions::{Permission, require_permission};
use crate::identity::stream_devices::{self, StreamDevice};
use crate::identity::{User, users};
use crate::voice;

/// A resposta do `pair-code`: o código para digitar (ou ler no QR) e quando ele vence.
#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct PairCodeResponse {
    /// 6 números, como `042917`.
    pub code: String,
    /// Em segundos (Unix).
    pub expires_at: i64,
}

/// `POST /api/stream-devices/pair-code`: um código novo para parear um aparelho. Só com a
/// permissão "Transmitir de um aparelho".
pub async fn pair_code(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<PairCodeResponse>, ApiError> {
    let (code, expires_at) = stream_devices::create_pair_code(&state.db, &user, now()).await?;
    Ok(Json(PairCodeResponse { code, expires_at }))
}

/// `GET /api/stream-devices`: os aparelhos de quem pede.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<StreamDevice>>, ApiError> {
    Ok(Json(stream_devices::list(&state.db, &user).await?))
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct RenameStreamDeviceRequest {
    pub name: String,
}

/// `PATCH /api/stream-devices/{id}`: troca o nome. Vale na próxima transmissão do aparelho.
pub async fn rename(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(request): ApiJson<RenameStreamDeviceRequest>,
) -> Result<Json<StreamDevice>, ApiError> {
    Ok(Json(
        stream_devices::rename(&state.db, &user, &id, &request.name).await?,
    ))
}

/// `DELETE /api/stream-devices/{id}`: desvincula. A sessão do aparelho deixa de valer, e a
/// transmissão dele, se estiver no ar, cai.
pub async fn unlink(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let device = stream_devices::unlink(&state.db, &user, &id).await?;
    voice::kick_in_background(voice::device_screen_identity(&user.id, &device.id));
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct PairStreamDeviceRequest {
    pub code: String,
    /// O nome que o aparelho sugere ("Odin 3"). Vazio vira "Aparelho".
    #[ts(optional)]
    pub name: Option<String>,
}

/// A resposta do `pair`: a sessão do aparelho, quem é o dono e o aparelho criado.
#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct PairStreamDeviceResponse {
    pub token: String,
    pub owner: UserView,
    pub device: StreamDevice,
}

/// `POST /api/stream-devices/pair`: o aparelho troca o código pela sessão dele. Sem sessão; conta
/// no limite de tentativas, como o convite.
pub async fn pair(
    State(state): State<AppState>,
    ApiJson(request): ApiJson<PairStreamDeviceRequest>,
) -> Result<Json<PairStreamDeviceResponse>, ApiError> {
    state.limiter.check()?;
    let result =
        stream_devices::pair(&state.db, &request.code, request.name.as_deref(), now()).await;
    if result.is_err() {
        state.limiter.record_failure();
    }
    let paired = result?;
    Ok(Json(PairStreamDeviceResponse {
        token: paired.token,
        owner: UserView::from(&paired.owner),
        device: paired.device,
    }))
}

/// Onde o dono está: uma sala de voz do grupo ou uma ligação privada.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
pub enum StreamTargetKind {
    Voice,
    Call,
}

/// Para onde a tela do aparelho vai agora.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct StreamTarget {
    /// O id da sala de voz ou da conversa privada.
    pub channel_id: String,
    pub kind: StreamTargetKind,
    /// "geral", ou o nome da outra pessoa na ligação.
    pub name: String,
}

/// A resposta do `self`: o aparelho, o dono e para onde a tela iria agora (`null` com o dono fora
/// de toda sala e ligação).
#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct StreamDeviceSelfResponse {
    pub device: StreamDevice,
    pub owner: UserView,
    pub target: Option<StreamTarget>,
}

/// `GET /api/stream-devices/self`: o que a tela do aparelho mostra.
pub async fn me(
    State(state): State<AppState>,
    current: CurrentStreamDevice,
) -> Result<Json<StreamDeviceSelfResponse>, ApiError> {
    let target = locate(&state, &current.owner).await?;
    Ok(Json(StreamDeviceSelfResponse {
        owner: UserView::from(&current.owner),
        device: current.device,
        target,
    }))
}

/// A resposta do `self/screen-token`: o token da tela e para onde ele vale.
#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct StreamDeviceTokenResponse {
    pub token: String,
    pub url: String,
    /// A identidade da conexão (`{dono}:screen-{aparelho}`).
    pub identity: String,
    pub target: StreamTarget,
}

/// `POST /api/stream-devices/self/screen-token`: o token da tela do aparelho, para a sala ou a
/// ligação em que o dono está agora. 409 com o dono fora de tudo; `share_limit` com a sala cheia;
/// 403 se o dono perdeu a permissão.
pub async fn screen_token(
    State(state): State<AppState>,
    current: CurrentStreamDevice,
) -> Result<Json<StreamDeviceTokenResponse>, ApiError> {
    let owner = &current.owner;
    require_permission(&state.db, owner, Permission::StreamFromDevice).await?;
    let target = locate(&state, owner).await?.ok_or_else(|| {
        ApiError::Conflict(
            "Entre numa sala de voz ou numa ligação no Ashtar para transmitir.".into(),
        )
    })?;
    check_room(&state, owner, &target.channel_id).await?;
    let identity = voice::device_screen_identity(&owner.id, &current.device.id);
    let JoinVoiceResponse { token, url, .. } = issue_screen_token(
        owner,
        &target.channel_id,
        &identity,
        Some(&current.device.name),
    )
    .await?;
    Ok(Json(StreamDeviceTokenResponse {
        token,
        url,
        identity,
        target,
    }))
}

/// Onde `user` está agora pela voz. A ligação atendida vem primeiro (o banco sabe dela sem
/// perguntar à LiveKit); depois a última lista de cada sala que o hub guarda; por fim, perguntando
/// a todas as salas da LiveKit, para o que mudou antes de a API subir.
async fn locate(state: &AppState, user: &User) -> Result<Option<StreamTarget>, ApiError> {
    if let Some(call) = calls::current_for(&state.db, &user.id).await?
        && call.outcome == CallOutcome::Answered
    {
        return call_target(state, user, &call.channel_id).await.map(Some);
    }
    let room = match state.hub.room_of(&user.id) {
        Some(room) => Some(room),
        None => voice::find_room_of(&user.id).await?,
    };
    let Some(room) = room else {
        return Ok(None);
    };
    if dms::get(&state.db, &room).await?.is_some() {
        return call_target(state, user, &room).await.map(Some);
    }
    let channel = channels::get_open_voice(&state.db, &room).await?;
    Ok(Some(StreamTarget {
        channel_id: channel.id,
        kind: StreamTargetKind::Voice,
        name: channel.name,
    }))
}

/// A ligação da conversa `channel_id`, com o nome da outra pessoa.
async fn call_target(
    state: &AppState,
    user: &User,
    channel_id: &str,
) -> Result<StreamTarget, ApiError> {
    let dm = dms::find_for(&state.db, &user.id, channel_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Essa ligação não existe.".into()))?;
    let other = users::get_by_id(&state.db, dm.other(&user.id)).await?;
    Ok(StreamTarget {
        channel_id: dm.id,
        kind: StreamTargetKind::Call,
        name: other.shown_name().to_owned(),
    })
}
