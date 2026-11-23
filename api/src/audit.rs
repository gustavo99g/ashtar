//! O registro do grupo (ADR 0034): quem fez o quê, em quem e onde. As rotas de voz, membros,
//! convites e canais gravam aqui logo depois de fazer a ação; só o dono lê
//! (`GET /api/admin/audit`), e as ações dele também entram. Guarda 1 ano.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;

use crate::error::ApiError;
use crate::identity::User;

/// De que parte do grupo é a linha: o filtro do Painel › Registro.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
pub enum AuditKind {
    Voice,
    Members,
    Invites,
    Channels,
}

impl AuditKind {
    fn key(self) -> &'static str {
        match self {
            Self::Voice => "voice",
            Self::Members => "members",
            Self::Invites => "invites",
            Self::Channels => "channels",
        }
    }

    fn from_key(key: &str) -> Option<Self> {
        [Self::Voice, Self::Members, Self::Invites, Self::Channels]
            .into_iter()
            .find(|kind| kind.key() == key)
    }
}

/// Uma ação para gravar.
pub struct Entry<'a> {
    pub kind: AuditKind,
    /// A chave da ação (`voz.silenciar`, `membros.remover`): o app monta a frase.
    pub action: &'a str,
    pub actor: &'a User,
    pub target: Option<&'a User>,
    /// O canal ou a sala, pelo nome.
    pub place: Option<String>,
    /// Um texto curto: a permissão, o tipo do convite, o nome novo.
    pub detail: Option<String>,
}

/// Grava `entry` às `now`.
pub async fn record(db: &SqlitePool, entry: Entry<'_>, now: i64) -> Result<(), ApiError> {
    sqlx::query(
        "INSERT INTO audit_log (at, kind, action, actor_id, actor_name, target_id, target_name,
             place, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(now)
    .bind(entry.kind.key())
    .bind(entry.action)
    .bind(&entry.actor.id)
    .bind(entry.actor.shown_name())
    .bind(entry.target.map(|user| user.id.as_str()))
    .bind(entry.target.map(User::shown_name))
    .bind(entry.place)
    .bind(entry.detail)
    .execute(db)
    .await?;
    Ok(())
}

/// O nome do canal `id`, para o `place` (arquivado também).
pub async fn channel_name(db: &SqlitePool, id: &str) -> Result<Option<String>, ApiError> {
    Ok(sqlx::query_scalar("SELECT name FROM channels WHERE id = ?")
        .bind(id)
        .fetch_optional(db)
        .await?)
}

/// Alguém numa linha do registro, com o nome de quando a ação aconteceu.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct AuditPerson {
    pub id: String,
    pub name: String,
}

/// Uma linha do registro, como o Painel mostra.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct AuditEntry {
    #[ts(type = "number")]
    pub id: i64,
    #[ts(type = "number")]
    pub at: i64,
    pub kind: AuditKind,
    pub action: String,
    pub actor: AuditPerson,
    pub target: Option<AuditPerson>,
    pub place: Option<String>,
    pub detail: Option<String>,
}

/// Quantas linhas por página.
pub const PAGE: i64 = 50;

type Row = (
    i64,
    i64,
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

/// Uma página do registro, da mais nova para a mais velha: as de `kind` (todas, sem ele), com id
/// menor que `before`.
pub async fn list(
    db: &SqlitePool,
    kind: Option<AuditKind>,
    before: Option<i64>,
) -> Result<Vec<AuditEntry>, ApiError> {
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT id, at, kind, action, actor_id, actor_name, target_id, target_name, place, detail
         FROM audit_log
         WHERE (?1 IS NULL OR kind = ?1) AND (?2 IS NULL OR id < ?2)
         ORDER BY id DESC
         LIMIT ?3",
    )
    .bind(kind.map(AuditKind::key))
    .bind(before)
    .bind(PAGE)
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .filter_map(
            |(
                id,
                at,
                kind,
                action,
                actor_id,
                actor_name,
                target_id,
                target_name,
                place,
                detail,
            )| {
                Some(AuditEntry {
                    id,
                    at,
                    kind: AuditKind::from_key(&kind)?,
                    action,
                    actor: AuditPerson {
                        id: actor_id,
                        name: actor_name,
                    },
                    target: target_id.map(|id| AuditPerson {
                        id,
                        name: target_name.unwrap_or_default(),
                    }),
                    place,
                    detail,
                })
            },
        )
        .collect())
}

/// Quanto o registro guarda: 1 ano.
pub const RETENTION_SECS: i64 = 365 * 24 * 60 * 60;

/// Apaga as linhas com mais de 1 ano e devolve quantas.
pub async fn sweep(db: &SqlitePool, now: i64) -> Result<u64, ApiError> {
    Ok(sqlx::query("DELETE FROM audit_log WHERE at < ?")
        .bind(now - RETENTION_SECS)
        .execute(db)
        .await?
        .rows_affected())
}
