//! Convites: criar, usar, revogar e listar.
//!
//! Dois tipos:
//! - **novo**: cria um membro com o nick escolhido. Vale até expirar ou até
//!   `max_uses` pessoas entrarem com ele, o que vier primeiro: um convite de
//!   5 minutos e 8 usos serve para mandar no grupo; o padrão (1 uso) serve
//!   para mandar no privado;
//! - **recuperação**: aponta para um membro que já existe e troca o
//!   dispositivo dele pelo de quem usar o convite (placa-mãe nova, computador
//!   novo). Sempre de uso único.
//!
//! O código aparece uma vez só, na criação: o banco guarda o hash. O convite
//! nunca é apagado; ele e os seus usos (`invite_uses`) são o histórico de
//! quem convidou quem.

use sqlx::{FromRow, SqlitePool};
use uuid::Uuid;

use super::permissions::{Action, require};
use super::{User, devices, users};
use crate::error::ApiError;
use crate::secret;

/// Validade padrão: 7 dias.
pub const DEFAULT_TTL_SECS: i64 = 7 * 24 * 60 * 60;

/// Validade mínima e máxima de um convite: de 1 minuto a 30 dias.
pub const MIN_TTL_SECS: i64 = 60;
pub const MAX_TTL_SECS: i64 = 30 * 24 * 60 * 60;

/// Limite de usos de um convite novo. Mais que isso é um convite aberto demais
/// para um grupo de 5 a 10 pessoas.
pub const MAX_USES_LIMIT: i64 = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InviteKind {
    New,
    Recovery,
}

impl InviteKind {
    fn as_db(self) -> &'static str {
        match self {
            Self::New => "new",
            Self::Recovery => "recovery",
        }
    }
}

/// Situação de um convite num instante.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InviteStatus {
    /// Ainda aceita gente.
    Pending,
    /// Todos os usos foram gastos.
    Exhausted,
    Revoked,
    Expired,
}

/// Uma linha do histórico, já com os nicks.
#[derive(Debug, Clone)]
pub struct InviteRecord {
    pub id: String,
    pub kind: String,
    pub target_nick: Option<String>,
    pub max_uses: i64,
    pub created_by_nick: String,
    pub created_at: i64,
    pub expires_at: i64,
    pub revoked_at: Option<i64>,
    /// Quem entrou com ele e quando, do primeiro para o último.
    pub uses: Vec<InviteUse>,
}

#[derive(Debug, Clone, FromRow)]
pub struct InviteUse {
    pub invite_id: String,
    pub nick: String,
    pub used_at: i64,
}

impl InviteRecord {
    pub fn status(&self, now: i64) -> InviteStatus {
        if self.uses.len() as i64 >= self.max_uses {
            InviteStatus::Exhausted
        } else if self.revoked_at.is_some() {
            InviteStatus::Revoked
        } else if self.expires_at <= now {
            InviteStatus::Expired
        } else {
            InviteStatus::Pending
        }
    }
}

/// Convite recém-criado: o código só existe aqui.
#[derive(Debug, Clone)]
pub struct CreatedInvite {
    pub id: String,
    pub code: String,
    pub expires_at: i64,
    pub max_uses: i64,
}

/// Cria um convite. `target` é obrigatório na recuperação e proibido no novo.
/// `max_uses` vale só para o novo (de 1 a [`MAX_USES_LIMIT`]); a recuperação
/// é sempre de uso único.
pub async fn create(
    db: &SqlitePool,
    actor: &User,
    kind: InviteKind,
    target: Option<&User>,
    ttl_secs: i64,
    max_uses: i64,
    now: i64,
) -> Result<CreatedInvite, ApiError> {
    match kind {
        InviteKind::New => require(actor, Action::CreateInvite)?,
        InviteKind::Recovery => require(actor, Action::CreateRecoveryInvite)?,
    }
    if !(MIN_TTL_SECS..=MAX_TTL_SECS).contains(&ttl_secs) {
        return Err(ApiError::InvalidRequest(
            "A validade do convite vai de 1 minuto a 30 dias.".into(),
        ));
    }
    let (target_id, max_uses) = match (kind, target) {
        (InviteKind::New, None) if (1..=MAX_USES_LIMIT).contains(&max_uses) => (None, max_uses),
        (InviteKind::New, None) => {
            return Err(ApiError::InvalidRequest(format!(
                "O número de usos vai de 1 a {MAX_USES_LIMIT}."
            )));
        }
        (InviteKind::New, Some(_)) => {
            return Err(ApiError::InvalidRequest(
                "Um convite novo não aponta para um membro.".into(),
            ));
        }
        (InviteKind::Recovery, Some(user)) if user.is_active() => (Some(user.id.clone()), 1),
        (InviteKind::Recovery, Some(_)) => {
            return Err(ApiError::Conflict("Esse membro foi removido.".into()));
        }
        (InviteKind::Recovery, None) => {
            return Err(ApiError::InvalidRequest(
                "Um convite de recuperação precisa de um membro.".into(),
            ));
        }
    };

    // O `User` que chegou pode estar velho: confere no banco que o membro ainda está ativo.
    if let Some(target_id) = &target_id {
        let active: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM users WHERE id = ? AND removed_at IS NULL")
                .bind(target_id)
                .fetch_optional(db)
                .await?;
        if active.is_none() {
            return Err(ApiError::Conflict("Esse membro foi removido.".into()));
        }
    }

    let invite = CreatedInvite {
        id: Uuid::new_v4().to_string(),
        code: secret::new_invite_code(),
        expires_at: now + ttl_secs,
        max_uses,
    };
    let normalized = secret::normalize_invite_code(&invite.code).expect("código gerado é válido");

    sqlx::query(
        "INSERT INTO invites
            (id, code_hash, kind, target_user_id, max_uses, created_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&invite.id)
    .bind(secret::hash(&normalized))
    .bind(kind.as_db())
    .bind(target_id)
    .bind(invite.max_uses)
    .bind(&actor.id)
    .bind(now)
    .bind(invite.expires_at)
    .execute(db)
    .await?;
    Ok(invite)
}

/// O histórico completo, do mais novo para o mais antigo.
pub async fn list(db: &SqlitePool) -> Result<Vec<InviteRecord>, ApiError> {
    #[derive(FromRow)]
    struct Row {
        id: String,
        kind: String,
        target_nick: Option<String>,
        max_uses: i64,
        created_by_nick: String,
        created_at: i64,
        expires_at: i64,
        revoked_at: Option<i64>,
    }

    let rows: Vec<Row> = sqlx::query_as(
        "SELECT i.id, i.kind, t.nick AS target_nick, i.max_uses, c.nick AS created_by_nick,
                i.created_at, i.expires_at, i.revoked_at
         FROM invites i
         JOIN users c ON c.id = i.created_by
         LEFT JOIN users t ON t.id = i.target_user_id
         ORDER BY i.created_at DESC",
    )
    .fetch_all(db)
    .await?;

    let uses: Vec<InviteUse> = sqlx::query_as(
        "SELECT iu.invite_id, u.nick, iu.used_at
         FROM invite_uses iu JOIN users u ON u.id = iu.user_id
         ORDER BY iu.used_at",
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| InviteRecord {
            uses: uses
                .iter()
                .filter(|u| u.invite_id == row.id)
                .cloned()
                .collect(),
            id: row.id,
            kind: row.kind,
            target_nick: row.target_nick,
            max_uses: row.max_uses,
            created_by_nick: row.created_by_nick,
            created_at: row.created_at,
            expires_at: row.expires_at,
            revoked_at: row.revoked_at,
        })
        .collect())
}

/// Revoga um convite pelo id ou pelo começo dele (no mínimo 4 caracteres,
/// como o `admin convites` mostra). Quem já entrou com ele continua membro;
/// ninguém mais entra.
pub async fn revoke(
    db: &SqlitePool,
    actor: &User,
    id_prefix: &str,
    now: i64,
) -> Result<(), ApiError> {
    require(actor, Action::RevokeInvite)?;
    if id_prefix.len() < 4 {
        return Err(ApiError::InvalidRequest(
            "Informe pelo menos 4 caracteres do id.".into(),
        ));
    }

    let matches: Vec<(String, i64, i64, Option<i64>, i64)> = sqlx::query_as(
        "SELECT i.id, i.max_uses,
                (SELECT COUNT(*) FROM invite_uses iu WHERE iu.invite_id = i.id),
                i.revoked_at, i.expires_at
         FROM invites i WHERE substr(i.id, 1, length(?1)) = ?1",
    )
    .bind(id_prefix)
    .fetch_all(db)
    .await?;

    let (id, max_uses, uses, revoked_at, expires_at) = match matches.as_slice() {
        [] => return Err(ApiError::NotFound("Nenhum convite com esse id.".into())),
        [one] => one.clone(),
        _ => {
            return Err(ApiError::Conflict(
                "Mais de um convite começa assim; use mais caracteres do id.".into(),
            ));
        }
    };
    if uses >= max_uses {
        return Err(ApiError::Conflict(
            "Esse convite já foi usado por completo. Para desfazer, remova o membro.".into(),
        ));
    }
    if revoked_at.is_some() || expires_at <= now {
        return Err(ApiError::Conflict("Esse convite já não vale mais.".into()));
    }

    sqlx::query("UPDATE invites SET revoked_at = ? WHERE id = ?")
        .bind(now)
        .bind(&id)
        .execute(db)
        .await?;
    Ok(())
}

/// Usa um convite com a chave deste dispositivo.
///
/// - Convite novo: cria o membro com `nick` e vincula o dispositivo.
/// - Recuperação: `nick` é ignorado; o membro do convite passa a usar este
///   dispositivo, e o anterior (com a sessão dele) deixa de valer.
///
/// Devolve o membro e o token de sessão. Tudo numa transação: se algo falhar,
/// o uso não conta.
pub async fn redeem(
    db: &SqlitePool,
    code: &str,
    device_key: &str,
    nick: Option<&str>,
    now: i64,
) -> Result<(User, String), ApiError> {
    let code = secret::normalize_invite_code(code).ok_or(ApiError::InvalidInvite)?;
    devices::validate_device_key(device_key)?;

    // IMMEDIATE: a transação já começa com a trava de escrita. Duas pessoas
    // usando o último lugar do convite ao mesmo tempo entram uma depois da
    // outra, e a segunda já vê o convite esgotado.
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;

    let invite: Option<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT i.id, i.kind, i.target_user_id FROM invites i
         WHERE i.code_hash = ? AND i.revoked_at IS NULL AND i.expires_at > ?
           AND (SELECT COUNT(*) FROM invite_uses iu WHERE iu.invite_id = i.id) < i.max_uses",
    )
    .bind(secret::hash(&code))
    .bind(now)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((invite_id, kind, target_id)) = invite else {
        return Err(ApiError::InvalidInvite);
    };

    if devices::key_in_use(&mut tx, device_key).await? {
        return Err(ApiError::DeviceAlreadyLinked);
    }

    let user: User = match (kind.as_str(), target_id) {
        ("recovery", Some(target_id)) => {
            let user: Option<User> = sqlx::query_as(
                "SELECT id, nick, is_owner, created_at, removed_at FROM users
                 WHERE id = ? AND removed_at IS NULL",
            )
            .bind(&target_id)
            .fetch_optional(&mut *tx)
            .await?;
            user.ok_or(ApiError::InvalidInvite)?
        }
        _ => {
            let nick = users::validate_nick(nick.unwrap_or_default())?;
            users::insert(&mut tx, &nick, false, now).await?
        }
    };

    let token = devices::link_and_open_session(&mut tx, &user.id, device_key, now).await?;

    sqlx::query("INSERT INTO invite_uses (invite_id, user_id, used_at) VALUES (?, ?, ?)")
        .bind(&invite_id)
        .bind(&user.id)
        .bind(now)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok((user, token))
}
