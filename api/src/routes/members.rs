//! Rotas de membros do Painel: a lista, as permissões de cada um, o beta,
//! desvincular, a recuperação e remover.
//!
//! O membro vem pelo `id` no caminho. Cada rota confere a ação com
//! `permissions::require` antes de procurar o membro: quem não pode recebe 403
//! sem descobrir se o id existe.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::auth::CurrentUser;
use super::extract::ApiJson;
use super::invites::CreatedInviteView;
use crate::AppState;
use crate::audit::{self, AuditKind};
use crate::chat::layout;
use crate::db::now;
use crate::error::ApiError;
use crate::identity::invites::{self, DEFAULT_TTL_SECS, InviteKind};
use crate::identity::permissions::{self, Action, GrantKind, Origin, Permission, require};
use crate::identity::users::{self, BetaGrant, JoinedWith, MemberDetails, PendingRecovery};
use crate::identity::{User, devices};
use crate::realtime::ServerEvent;
use crate::voice;

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct DeviceView {
    pub linked_at: i64,
}

/// Um membro na lista do Painel.
#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct MemberView {
    pub id: String,
    pub nick: String,
    pub display_name: Option<String>,
    /// O id do arquivo da foto de perfil, ou `null` (ADR 0031).
    #[ts(optional = nullable)]
    pub avatar: Option<String>,
    pub is_owner: bool,
    pub created_at: i64,
    pub removed_at: Option<i64>,
    /// `null` sem computador.
    pub device: Option<DeviceView>,
    /// `null` com o beta desligado.
    pub beta: Option<BetaGrant>,
    /// `null` no dono.
    pub joined_with: Option<JoinedWith>,
    pub pending_recovery: Option<PendingRecovery>,
}

impl From<MemberDetails> for MemberView {
    fn from(details: MemberDetails) -> Self {
        let user = details.user;
        Self {
            id: user.id,
            nick: user.nick,
            display_name: user.display_name,
            avatar: user.avatar_id,
            is_owner: user.is_owner,
            created_at: user.created_at,
            removed_at: user.removed_at,
            device: details
                .device_linked_at
                .map(|linked_at| DeviceView { linked_at }),
            beta: details.beta,
            joined_with: details.joined_with,
            pending_recovery: details.pending_recovery,
        }
    }
}

/// `GET /api/members`: todos, os removidos inclusive, do mais antigo para o
/// mais novo.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<MemberView>>, ApiError> {
    require(&user, Action::ViewPanel)?;
    let members = users::list_details(&state.db, now()).await?;
    Ok(Json(members.into_iter().map(MemberView::from).collect()))
}

/// Uma linha da gaveta de permissões.
#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct GrantView {
    pub key: &'static str,
    pub kind: GrantKind,
    pub label: &'static str,
    pub granted: bool,
    /// `"owner"`, `"direct"` ou `null` quando não tem.
    pub origin: Option<Origin>,
    pub granted_at: Option<i64>,
}

/// `GET /api/members/{id}/permissions`: cada permissão e ação, se o membro tem
/// e de onde vem.
pub async fn permissions(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<Vec<GrantView>>, ApiError> {
    require(&user, Action::ViewPanel)?;
    let target = users::get_by_id(&state.db, &id).await?;
    let grants = permissions::overview(&state.db, &target).await?;
    Ok(Json(
        grants
            .into_iter()
            .map(|grant| GrantView {
                key: grant.key,
                kind: grant.kind,
                label: grant.label,
                granted: grant.origin.is_some(),
                origin: grant.origin,
                granted_at: grant.granted_at,
            })
            .collect(),
    ))
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct SetBetaRequest {
    pub enabled: bool,
}

/// `PUT /api/members/{id}/beta` com `{ "enabled": true }`. Repetir não é erro.
pub async fn set_beta(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(request): ApiJson<SetBetaRequest>,
) -> Result<StatusCode, ApiError> {
    require(&user, Action::ManagePermissions)?;
    let target = users::get_by_id(&state.db, &id).await?;
    permissions::set(
        &state.db,
        &user,
        &target,
        Permission::BetaUpdates,
        request.enabled,
        now(),
    )
    .await?;
    log_permission(
        &state,
        &user,
        &target,
        Permission::BetaUpdates,
        request.enabled,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// O corpo do `PUT /api/members/{id}/permissions/{key}`.
#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct SetPermissionRequest {
    pub enabled: bool,
}

/// `PUT /api/members/{id}/permissions/{key}` com `{ "enabled": true }`: liga ou
/// desliga qualquer [`Permission`] pela chave (`canais.gerenciar`,
/// `atualizacoes.beta`). Chave que não existe: 404. A rota do beta continua,
/// porque o app da 0.2.2 usa ela.
pub async fn set_permission(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((id, key)): Path<(String, String)>,
    ApiJson(request): ApiJson<SetPermissionRequest>,
) -> Result<StatusCode, ApiError> {
    require(&user, Action::ManagePermissions)?;
    let permission = Permission::from_key(&key)
        .ok_or_else(|| ApiError::NotFound("Nenhuma permissão com essa chave.".into()))?;
    let target = users::get_by_id(&state.db, &id).await?;
    permissions::set(
        &state.db,
        &user,
        &target,
        permission,
        request.enabled,
        now(),
    )
    .await?;
    log_permission(&state, &user, &target, permission, request.enabled).await?;
    // Quem gerencia os canais vê os restritos: a lista dele muda.
    if permission == Permission::ManageChannels {
        let version = layout::touch(&state.db).await?;
        state.hub.publish(&ServerEvent::ChannelsChanged { version });
    }
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/members/{id}/unlink`: tira o computador do membro, derruba a
/// sessão, fecha o WebSocket (4001) e o tira da sala de voz. Para voltar, ele precisa de uma recuperação,
/// que o app cria logo em seguida quando a caixa "Já criar o convite de
/// recuperação" está marcada.
pub async fn unlink(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    require(&user, Action::UnlinkDevice)?;
    let target = users::get_by_id(&state.db, &id).await?;
    devices::unlink(&state.db, &user, &target).await?;
    log_member(&state, &user, &target, "membros.desvincular", None).await?;
    state.hub.close_user(&target.id);
    voice::kick_in_background(target.id);
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/members/{id}/recovery-invite`: convite de recuperação de uso
/// único, válido por 7 dias, como o padrão do `admin recuperacao`.
pub async fn recovery_invite(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<CreatedInviteView>), ApiError> {
    require(&user, Action::CreateRecoveryInvite)?;
    let target = users::get_by_id(&state.db, &id).await?;
    let created = invites::create(
        &state.db,
        &user,
        InviteKind::Recovery,
        Some(&target),
        DEFAULT_TTL_SECS,
        1,
        now(),
    )
    .await?;
    audit::record(
        &state.db,
        audit::Entry {
            kind: AuditKind::Invites,
            action: "convites.recuperacao",
            actor: &user,
            target: Some(&target),
            place: None,
            detail: None,
        },
        now(),
    )
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(CreatedInviteView::new(
            &state,
            InviteKind::Recovery,
            created,
        )),
    ))
}

/// `DELETE /api/members/{id}`: remove o membro. Ele sai na hora (da sessão, do
/// WebSocket e da sala de voz), some da coluna de membros (`member.left`) e o
/// nick fica livre.
pub async fn remove(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    require(&user, Action::RemoveMember)?;
    let target = users::get_by_id(&state.db, &id).await?;
    users::remove(&state.db, &user, &target, now()).await?;
    log_member(&state, &user, &target, "membros.remover", None).await?;
    state.hub.close_user(&target.id);
    state.hub.publish(&ServerEvent::MemberLeft {
        user_id: target.id.clone(),
    });
    voice::kick_in_background(target.id);
    Ok(StatusCode::NO_CONTENT)
}

/// Grava no registro uma ação de membros em `target`.
async fn log_member(
    state: &AppState,
    actor: &User,
    target: &User,
    action: &str,
    detail: Option<String>,
) -> Result<(), ApiError> {
    audit::record(
        &state.db,
        audit::Entry {
            kind: AuditKind::Members,
            action,
            actor,
            target: Some(target),
            place: None,
            detail,
        },
        now(),
    )
    .await
}

/// Grava no registro que `actor` deu ou tirou `permission` de `target`.
async fn log_permission(
    state: &AppState,
    actor: &User,
    target: &User,
    permission: Permission,
    granted: bool,
) -> Result<(), ApiError> {
    let action = if granted {
        "permissoes.dar"
    } else {
        "permissoes.tirar"
    };
    log_member(
        state,
        actor,
        target,
        action,
        Some(permission.label().into()),
    )
    .await
}
