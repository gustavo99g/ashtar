//! Rotas de entrada e do perfil: usar convite, entrar com o dispositivo,
//! `/api/me` e a troca do nome visível.
//!
//! Ninguém usa estas rotas ainda: o desktop passa a chamá-las junto com a
//! parte visual. Até lá, dá para testá-las com `curl`.

use axum::Json;
use axum::extract::{FromRequestParts, State};
use axum::http::HeaderMap;
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::extract::ApiJson;
use crate::AppState;
use crate::db::now;
use crate::error::ApiError;
use crate::identity::permissions::{self, Action, Permission};
use crate::identity::status::{self, Status};
use crate::identity::users::Person;
use crate::identity::{User, devices, invites, users};
use crate::realtime::ServerEvent;

#[derive(Debug, Deserialize)]
pub struct RedeemRequest {
    pub code: String,
    pub device_key: String,
    /// Obrigatório no convite novo; ignorado no de recuperação.
    pub nick: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub device_key: String,
}

/// A resposta do `redeem` e do `login`. No app, quem recebe é o Rust, que a
/// devolve igual ao JavaScript.
#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct SessionResponse {
    pub token: String,
    pub user: UserView,
}

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct UserView {
    pub id: String,
    pub nick: String,
    /// `null` quando está em branco: aí o app mostra o nick.
    pub display_name: Option<String>,
    pub is_owner: bool,
    /// O id do arquivo da foto de perfil, ou `null` (ADR 0031).
    #[ts(optional = nullable)]
    pub avatar: Option<String>,
}

impl From<&User> for UserView {
    fn from(user: &User) -> Self {
        Self {
            id: user.id.clone(),
            nick: user.nick.clone(),
            display_name: user.display_name.clone(),
            is_owner: user.is_owner,
            avatar: user.avatar_id.clone(),
        }
    }
}

/// De onde o app busca atualizações.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
pub enum UpdateChannel {
    Stable,
    Beta,
}

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct MeResponse {
    pub user: UserView,
    /// Chaves das permissões que o membro tem.
    pub permissions: Vec<&'static str>,
    pub update_channel: UpdateChannel,
    /// O status de verdade, que só a própria pessoa vê.
    pub status: Status,
    /// O que mostrar ou esconder na interface. Quem decide de verdade é a API.
    pub can_create_invite: bool,
    /// Se o menu mostra o Painel de controle.
    pub can_view_panel: bool,
    /// Se a lista de canais mostra criar, editar, arquivar e arrastar.
    pub can_manage_channels: bool,
    /// Se o cartão mostra "Mover para" e "Desconectar da voz", e se os avatares
    /// das salas se arrastam.
    pub can_move_members: bool,
    /// Se o Painel mostra a tela Emojis.
    pub can_manage_emojis: bool,
    /// Se lê os logs que os membros mandam (Painel › Logs).
    pub can_view_logs: bool,
    /// Se o cartão de quem está numa sala de voz mostra a seção Moderação (v0.8).
    pub can_moderate_voice: bool,
    /// Se a tela Sons deixa carregar um som (v0.9).
    pub can_send_sounds: bool,
    /// Se a tela Sons mostra as abas Aprovação e Todos os sons (v0.9).
    pub can_approve_sounds: bool,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct UpdateMeRequest {
    /// O nome visível novo. Texto vazio ou `null` volta para o nick.
    pub display_name: Option<String>,
}

/// `POST /api/auth/redeem`: usa um convite e já devolve a sessão.
pub async fn redeem(
    State(state): State<AppState>,
    ApiJson(request): ApiJson<RedeemRequest>,
) -> Result<Json<SessionResponse>, ApiError> {
    state.limiter.check()?;
    let result = invites::redeem(
        &state.db,
        &request.code,
        &request.device_key,
        request.nick.as_deref(),
        now(),
    )
    .await;
    if matches!(result, Err(ApiError::InvalidInvite(_))) {
        state.limiter.record_failure();
    }
    let invites::Redeemed {
        user,
        token,
        new_member,
    } = result?;
    // A recuperação devolve quem já existia: só o convite novo avisa o grupo.
    if new_member {
        state.hub.publish(&ServerEvent::MemberJoined {
            person: Person::new(&user, None),
        });
    }
    Ok(Json(SessionResponse {
        token,
        user: UserView::from(&user),
    }))
}

/// `POST /api/auth/login`: entra com um dispositivo já vinculado.
///
/// Fica fora do limite de tentativas, de propósito: a chave do dispositivo tem
/// 256 bits, então adivinhá-la é inviável; e todo app de quem ainda não tem
/// convite chama o login ao abrir (e recebe `unknown_device`), o que travaria os
/// convites de todos. Bloquear o login também deixaria de fora quem já é membro.
pub async fn login(
    State(state): State<AppState>,
    ApiJson(request): ApiJson<LoginRequest>,
) -> Result<Json<SessionResponse>, ApiError> {
    let (user, token) = devices::login(&state.db, &request.device_key, now()).await?;
    Ok(Json(SessionResponse {
        token,
        user: UserView::from(&user),
    }))
}

/// `GET /api/me`: quem sou, o que posso e qual canal de atualização uso.
pub async fn me(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<MeResponse>, ApiError> {
    Ok(Json(me_response(&state, &user).await?))
}

/// `PATCH /api/me`: troca o nome visível. Responde como o `GET /api/me`, já
/// com o nome novo, para o app atualizar o que mostra sem outra chamada.
pub async fn update_me(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(request): ApiJson<UpdateMeRequest>,
) -> Result<Json<MeResponse>, ApiError> {
    let before = user.display_name.clone();
    let user = users::set_display_name(&state.db, &user, request.display_name.as_deref()).await?;
    if user.display_name != before {
        publish_user_updated(&state, &user);
    }
    Ok(Json(me_response(&state, &user).await?))
}

/// O `user.updated` para todos: o nome visível ou a foto mudou (ADR 0031).
fn publish_user_updated(state: &AppState, user: &User) {
    state.hub.publish(&ServerEvent::UserUpdated {
        id: user.id.clone(),
        display_name: user.display_name.clone(),
        avatar: user.avatar_id.clone(),
    });
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct SetAvatarRequest {
    /// Um arquivo `avatar` enviado antes pelo `POST /api/files` (256×256 WebP, feito no app).
    pub file_id: String,
}

/// `PUT /api/me/avatar`: troca a foto de perfil, por uma nova ou por uma que a pessoa já usou. A
/// antiga fica guardada (`GET /api/me/avatars`).
pub async fn set_avatar(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(request): ApiJson<SetAvatarRequest>,
) -> Result<Json<MeResponse>, ApiError> {
    change_avatar(state, user, Some(&request.file_id)).await
}

/// `DELETE /api/me/avatar`: tira a foto; volta a letra e a cor do nick. A foto fica guardada.
pub async fn remove_avatar(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<MeResponse>, ApiError> {
    change_avatar(state, user, None).await
}

async fn change_avatar(
    state: AppState,
    user: User,
    file_id: Option<&str>,
) -> Result<Json<MeResponse>, ApiError> {
    let changed = user.avatar_id.as_deref() != file_id;
    let (user, pruned) = users::set_avatar(&state.db, &user, file_id, now()).await?;
    for old in pruned {
        if let Err(error) = state.files.delete(&old).await {
            eprintln!("foto {old}: não deu para apagar do disco: {error}");
        }
    }
    if changed {
        publish_user_updated(&state, &user);
    }
    Ok(Json(me_response(&state, &user).await?))
}

/// `GET /api/me/avatars`: as fotos que a pessoa já usou, da usada por último para a mais antiga.
pub async fn list_avatars(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<users::AvatarFile>>, ApiError> {
    Ok(Json(users::list_avatars(&state.db, &user.id).await?))
}

/// `DELETE /api/me/avatars/{id}`: apaga uma foto guardada. A de agora não (409).
pub async fn delete_avatar(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    axum::extract::Path(file_id): axum::extract::Path<String>,
) -> Result<axum::http::StatusCode, ApiError> {
    users::delete_avatar(&state.db, &user, &file_id).await?;
    if let Err(error) = state.files.delete(&file_id).await {
        eprintln!("foto {file_id}: não deu para apagar do disco: {error}");
    }
    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct SetStatusRequest {
    pub status: Status,
}

/// `PUT /api/me/status`: troca o status e responde como o `GET /api/me`. Um
/// valor fora dos três é 422, pelo próprio formato do pedido.
///
/// Grava e só depois avisa: os outros recebem o que podem ver
/// (`presence.changed`), e as conexões da pessoa, o status de verdade
/// (`status.changed`).
pub async fn set_status(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(request): ApiJson<SetStatusRequest>,
) -> Result<Json<MeResponse>, ApiError> {
    status::set(&state.db, &user.id, request.status).await?;
    state.hub.set_status(&user.id, request.status);
    Ok(Json(me_response(&state, &user).await?))
}

async fn me_response(state: &AppState, user: &User) -> Result<MeResponse, ApiError> {
    let effective = permissions::effective(&state.db, user).await?;
    let beta = effective.iter().any(|(p, _)| *p == Permission::BetaUpdates);

    Ok(MeResponse {
        user: UserView::from(user),
        permissions: effective.iter().map(|(p, _)| p.key()).collect(),
        update_channel: if beta {
            UpdateChannel::Beta
        } else {
            UpdateChannel::Stable
        },
        status: status::get(&state.db, &user.id).await?,

        can_create_invite: permissions::can(user, Action::CreateInvite),
        can_view_panel: permissions::can(user, Action::ViewPanel),
        can_manage_channels: effective
            .iter()
            .any(|(p, _)| *p == Permission::ManageChannels),
        can_move_members: effective.iter().any(|(p, _)| *p == Permission::MoveMembers),
        can_manage_emojis: effective
            .iter()
            .any(|(p, _)| *p == Permission::ManageEmojis),
        can_view_logs: effective.iter().any(|(p, _)| *p == Permission::ViewLogs),
        can_moderate_voice: effective
            .iter()
            .any(|(p, _)| *p == Permission::ModerateVoice),
        can_send_sounds: effective
            .iter()
            .any(|(p, _)| matches!(p, Permission::SendSounds | Permission::ApproveSounds)),
        can_approve_sounds: effective
            .iter()
            .any(|(p, _)| *p == Permission::ApproveSounds),
    })
}

/// Extrator: o membro do `Authorization: Bearer <token>`. Sem token, token
/// inválido ou membro removido, a rota responde 401 sem rodar.
pub struct CurrentUser(pub User);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let token = bearer_token(&parts.headers).ok_or(ApiError::Unauthenticated)?;
        let user = devices::authenticate(&state.db, token, now()).await?;
        Ok(Self(user))
    }
}

/// O token de `Authorization: Bearer <token>`. O esquema não diferencia
/// maiúscula de minúscula (RFC 9110), e o token não pode ser vazio.
fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    let token = token.trim();
    (scheme.eq_ignore_ascii_case("bearer") && !token.is_empty()).then_some(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(value: &str) -> HeaderMap {
        let mut map = HeaderMap::new();
        map.insert(AUTHORIZATION, value.parse().unwrap());
        map
    }

    #[test]
    fn o_esquema_nao_diferencia_maiuscula() {
        for scheme in ["Bearer", "bearer", "BEARER"] {
            let map = headers(&format!("{scheme} abc123"));
            assert_eq!(bearer_token(&map), Some("abc123"));
        }
    }

    #[test]
    fn recusa_o_que_nao_e_bearer_com_token() {
        assert_eq!(bearer_token(&HeaderMap::new()), None);
        assert_eq!(bearer_token(&headers("Basic abc123")), None);
        assert_eq!(bearer_token(&headers("Bearer")), None);
        assert_eq!(bearer_token(&headers("Bearer   ")), None);
        assert_eq!(bearer_token(&headers("abc123")), None);
    }
}
