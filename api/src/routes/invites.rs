//! Rotas de convites.
//!
//! `GET /api/invites/{código}` é a única sem sessão: a tela de entrada lê o
//! convite antes de a pessoa ter conta. Ela conta no limite de tentativas como
//! o `redeem`; senão viraria um jeito de testar códigos sem limite.
//!
//! As outras são do Painel: criar, listar e revogar. Chamam as mesmas funções
//! de `identity/` que o `admin`, e cada uma confere a ação com
//! `permissions::require` antes de tudo.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::auth::CurrentUser;
use super::extract::ApiJson;
use crate::AppState;
use crate::db::now;
use crate::error::ApiError;
use crate::identity::User;
use crate::identity::invites::{
    self, CreatedInvite, InviteKind, InviteRecord, InviteStatus, NewInvite, Preset,
};
use crate::identity::permissions::{Action, require};

/// Nick e nome visível, sem o id: o que uma rota sem sessão pode mostrar.
#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct NameView {
    pub nick: String,
    pub display_name: Option<String>,
}

impl From<&User> for NameView {
    fn from(user: &User) -> Self {
        Self {
            nick: user.nick.clone(),
            display_name: user.display_name.clone(),
        }
    }
}

#[derive(Debug, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
pub enum InvitePreviewView {
    New {
        invited_by: NameView,
        expires_at: i64,
    },
    Recovery {
        account: NameView,
        expires_at: i64,
    },
}

/// `GET /api/invites/{código}`: lê o convite sem gastar um uso.
pub async fn preview(
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> Result<Json<InvitePreviewView>, ApiError> {
    state.limiter.check()?;
    let result = invites::preview(&state.db, &code, now()).await;
    if matches!(result, Err(ApiError::InvalidInvite)) {
        state.limiter.record_failure();
    }
    let preview = result?;
    let person = NameView::from(&preview.person);
    Ok(Json(match preview.kind {
        InviteKind::New => InvitePreviewView::New {
            invited_by: person,
            expires_at: preview.expires_at,
        },
        InviteKind::Recovery => InvitePreviewView::Recovery {
            account: person,
            expires_at: preview.expires_at,
        },
    }))
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct CreateInviteRequest {
    pub preset: Preset,
    /// Só no `custom`: validade em segundos (de 60 a 30 dias).
    #[ts(optional)]
    pub ttl_secs: Option<i64>,
    /// Só no `custom`: de 1 a 50 pessoas.
    #[ts(optional)]
    pub max_uses: Option<i64>,
}

/// Um convite recém-criado. O código e o link só aparecem aqui.
#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct CreatedInviteView {
    pub id: String,
    pub code: String,
    pub link: String,
    pub expires_at: i64,
    pub max_uses: i64,
    /// `null` na recuperação.
    pub preset: Option<Preset>,
}

impl CreatedInviteView {
    pub fn new(state: &AppState, kind: InviteKind, invite: CreatedInvite) -> Self {
        Self {
            link: state.invite_link(kind, &invite.code),
            id: invite.id,
            code: invite.code,
            expires_at: invite.expires_at,
            max_uses: invite.max_uses,
            preset: invite.preset,
        }
    }
}

/// `POST /api/invites`: cria um convite novo pelo modelo. Em `person` e `group`
/// a validade e os usos são os da API, e o que vier no corpo é ignorado.
pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(request): ApiJson<CreateInviteRequest>,
) -> Result<(StatusCode, Json<CreatedInviteView>), ApiError> {
    require(&user, Action::CreateInvite)?;
    let invite = match (request.preset, request.ttl_secs, request.max_uses) {
        (Preset::Person, ..) => NewInvite::Person,
        (Preset::Group, ..) => NewInvite::Group,
        (Preset::Custom, Some(ttl_secs), Some(max_uses)) => {
            NewInvite::Custom { ttl_secs, max_uses }
        }
        (Preset::Custom, ..) => {
            return Err(ApiError::InvalidRequest(
                "No convite do seu jeito, informe a validade e o número de pessoas.".into(),
            ));
        }
    };
    let created = invites::create_new(&state.db, &user, invite, now()).await?;
    Ok((
        StatusCode::CREATED,
        Json(CreatedInviteView::new(&state, InviteKind::New, created)),
    ))
}

/// Quem criou, o alvo da recuperação ou quem entrou: id, nick e nome visível.
#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct MemberRef {
    pub id: String,
    pub nick: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct InviteUseView {
    pub user: MemberRef,
    pub used_at: i64,
}

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct InviteView {
    pub id: String,
    /// `"new"` ou `"recovery"`.
    #[ts(as = "InviteKind")]
    pub kind: String,
    pub preset: Option<Preset>,
    /// `"pending"`, `"exhausted"`, `"revoked"` ou `"expired"`.
    pub status: InviteStatus,
    pub created_by: MemberRef,
    /// Só na recuperação: de quem é a conta.
    pub target: Option<MemberRef>,
    pub created_at: i64,
    pub expires_at: i64,
    pub revoked_at: Option<i64>,
    pub max_uses: i64,
    /// Do primeiro ao último que entrou.
    pub uses: Vec<InviteUseView>,
}

impl InviteView {
    fn new(record: InviteRecord, now: i64) -> Self {
        let status = record.status(now);
        let target = record.target_id.map(|id| MemberRef {
            id,
            nick: record.target_nick.unwrap_or_default(),
            display_name: record.target_display_name,
        });
        Self {
            id: record.id,
            kind: record.kind,
            preset: record.preset,
            status,
            created_by: MemberRef {
                id: record.created_by_id,
                nick: record.created_by_nick,
                display_name: record.created_by_display_name,
            },
            target,
            created_at: record.created_at,
            expires_at: record.expires_at,
            revoked_at: record.revoked_at,
            max_uses: record.max_uses,
            uses: record
                .uses
                .into_iter()
                .map(|used| InviteUseView {
                    user: MemberRef {
                        id: used.user_id,
                        nick: used.nick,
                        display_name: used.display_name,
                    },
                    used_at: used.used_at,
                })
                .collect(),
        }
    }
}

/// `GET /api/invites`: o histórico, do mais novo para o mais antigo.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<InviteView>>, ApiError> {
    require(&user, Action::ViewPanel)?;
    let now = now();
    let records = invites::list(&state.db).await?;
    Ok(Json(
        records
            .into_iter()
            .map(|record| InviteView::new(record, now))
            .collect(),
    ))
}

/// `POST /api/invites/{id}/revoke`: revoga pelo id inteiro.
pub async fn revoke(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    require(&user, Action::RevokeInvite)?;
    invites::revoke_by_id(&state.db, &user, &id, now()).await?;
    Ok(StatusCode::NO_CONTENT)
}
