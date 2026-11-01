//! Canais de texto e salas de voz.

use serde::Serialize;
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;

use crate::error::ApiError;

/// O tipo do canal. A chave em texto é a do banco.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
pub enum ChannelKind {
    Text,
    Voice,
}

/// Um canal como o banco guarda.
#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct Channel {
    pub id: String,
    pub kind: ChannelKind,
    pub name: String,
    pub topic: Option<String>,
    pub category_id: Option<String>,
    pub position: i64,
    pub created_at: i64,
    pub archived_at: Option<i64>,
}

/// O canal de texto `id`, se existe e não está arquivado. Sala de voz e canal
/// arquivado dão o mesmo `NotFound` de um id que não existe.
pub async fn get_open_text(db: &SqlitePool, id: &str) -> Result<Channel, ApiError> {
    let channel: Option<Channel> = sqlx::query_as(
        "SELECT id, kind, name, topic, category_id, position, created_at, archived_at
         FROM channels WHERE id = ? AND kind = 'text' AND archived_at IS NULL",
    )
    .bind(id)
    .fetch_optional(db)
    .await?;
    channel.ok_or_else(|| ApiError::NotFound("Esse canal não existe ou foi arquivado.".into()))
}
