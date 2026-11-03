//! Categorias: criar, renomear, arquivar e desarquivar. Uma categoria agrupa
//! canais de qualquer tipo (ADR 0016).
//!
//! Como em `channels`, toda mudança recebe o `actor`, confere "Gerenciar
//! canais" e devolve a versão nova da lista.

use sqlx::{SqliteConnection, SqlitePool};
use uuid::Uuid;

use super::channels::{next_position, validate_label};
use super::layout::{self, Category, select_category};
use crate::error::ApiError;
use crate::identity::User;
use crate::identity::permissions::{Permission, require_permission};

async fn get(conn: &mut SqliteConnection, id: &str) -> Result<Category, ApiError> {
    let category: Option<Category> = sqlx::query_as(select_category!("WHERE id = ?"))
        .bind(id)
        .fetch_optional(conn)
        .await?;
    category.ok_or_else(|| ApiError::NotFound("Nenhuma categoria com esse id.".into()))
}

async fn next_category_position(conn: &mut SqliteConnection) -> Result<i64, ApiError> {
    let last: Option<i64> =
        sqlx::query_scalar("SELECT MAX(position) FROM categories WHERE archived_at IS NULL")
            .fetch_one(conn)
            .await?;
    Ok(last.map_or(0, |last| last + 1))
}

/// Cria uma categoria vazia no fim da lista. Devolve a categoria e a versão nova.
pub async fn create(
    db: &SqlitePool,
    actor: &User,
    name: &str,
    now: i64,
) -> Result<(Category, i64), ApiError> {
    require_permission(db, actor, Permission::ManageChannels).await?;
    let name = validate_label(name)?;
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    let id = Uuid::now_v7().to_string();
    let position = next_category_position(&mut tx).await?;
    sqlx::query("INSERT INTO categories (id, name, position, created_at) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(&name)
        .bind(position)
        .bind(now)
        .execute(&mut *tx)
        .await?;
    let version = layout::bump(&mut tx).await?;
    let category = get(&mut tx, &id).await?;
    tx.commit().await?;
    Ok((category, version))
}

/// Renomeia uma categoria aberta. Devolve a categoria e a versão nova, ou
/// `None` na versão se o nome é o mesmo.
pub async fn rename(
    db: &SqlitePool,
    actor: &User,
    id: &str,
    name: &str,
) -> Result<(Category, Option<i64>), ApiError> {
    require_permission(db, actor, Permission::ManageChannels).await?;
    let name = validate_label(name)?;
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    let category = get(&mut tx, id).await?;
    if category.archived_at.is_some() {
        return Err(ApiError::Conflict(
            "Essa categoria está arquivada: desarquive antes de renomear.".into(),
        ));
    }
    if name == category.name {
        return Ok((category, None));
    }
    sqlx::query("UPDATE categories SET name = ? WHERE id = ?")
        .bind(&name)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let version = layout::bump(&mut tx).await?;
    let category = get(&mut tx, id).await?;
    tx.commit().await?;
    Ok((category, Some(version)))
}

/// Arquiva a categoria e leva os canais abertos dela para o fim do topo, na
/// mesma ordem: arquivar a categoria não esconde canal nenhum. Devolve a versão
/// nova, ou `None` se já estava arquivada.
pub async fn archive(
    db: &SqlitePool,
    actor: &User,
    id: &str,
    now: i64,
) -> Result<Option<i64>, ApiError> {
    require_permission(db, actor, Permission::ManageChannels).await?;
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    let category = get(&mut tx, id).await?;
    if category.archived_at.is_some() {
        return Ok(None);
    }
    let channels: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM channels WHERE category_id = ? AND archived_at IS NULL
         ORDER BY position, created_at",
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await?;
    let first = next_position(&mut tx, None).await?;
    for (offset, channel_id) in channels.iter().enumerate() {
        sqlx::query("UPDATE channels SET category_id = NULL, position = ? WHERE id = ?")
            .bind(first + offset as i64)
            .bind(channel_id)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("UPDATE categories SET archived_at = ? WHERE id = ?")
        .bind(now)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let version = layout::bump(&mut tx).await?;
    tx.commit().await?;
    Ok(Some(version))
}

/// Desarquiva vazia, no fim da lista. Os canais que estavam nela continuam onde
/// estão; quem gerencia arrasta de volta. Devolve a versão nova, ou `None` se
/// já estava aberta.
pub async fn unarchive(db: &SqlitePool, actor: &User, id: &str) -> Result<Option<i64>, ApiError> {
    require_permission(db, actor, Permission::ManageChannels).await?;
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    let category = get(&mut tx, id).await?;
    if category.archived_at.is_none() {
        return Ok(None);
    }
    let position = next_category_position(&mut tx).await?;
    sqlx::query("UPDATE categories SET archived_at = NULL, position = ? WHERE id = ?")
        .bind(position)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let version = layout::bump(&mut tx).await?;
    tx.commit().await?;
    Ok(Some(version))
}
