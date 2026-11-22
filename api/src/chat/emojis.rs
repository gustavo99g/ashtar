//! Os emojis do grupo (decisão 31 do plano da v0.7): quem tem "Gerenciar emojis" sobe uma imagem
//! (o app reduz PNG, JPEG e WebP para 128×128; o GIF animado vai como está), com um nome único.
//! No texto, `:nome:` vira a imagem; nas reações, o emoji vai como `c:<id>`.

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use crate::error::ApiError;
use crate::identity::User;
use crate::identity::permissions::{Permission, require_permission};

/// Quantos emojis o grupo pode ter.
pub const EMOJIS_MAX: i64 = 100;
/// O maior arquivo de um emoji (o GIF animado é o que chega perto).
pub const EMOJI_MAX_BYTES: i64 = 256 * 1024;
/// Os tipos aceitos.
const MIMES: [&str; 4] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS, FromRow)]
#[ts(export, export_to = "index.ts")]
pub struct Emoji {
    pub id: String,
    pub name: String,
    /// A imagem (`GET /api/files/{id}`).
    pub file_id: String,
    /// GIF: o app não congela.
    pub animated: bool,
    pub created_by: String,
    #[ts(type = "number")]
    pub created_at: i64,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct CreateEmojiRequest {
    pub name: String,
    /// Um arquivo `emoji` enviado antes pelo `POST /api/files`.
    pub file_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct RenameEmojiRequest {
    pub name: String,
}

/// Confere o nome: 2 a 32 letras minúsculas, números e `_`. Devolve sem os `:` das pontas.
pub fn validate_name(input: &str) -> Result<String, ApiError> {
    let name = input.trim().trim_matches(':');
    let ok = (2..=32).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');
    if ok {
        Ok(name.to_owned())
    } else {
        Err(ApiError::InvalidRequest(
            "O nome tem de 2 a 32 letras minúsculas, números ou _.".into(),
        ))
    }
}

/// Todos, por nome.
pub async fn list(db: &SqlitePool) -> Result<Vec<Emoji>, ApiError> {
    Ok(sqlx::query_as(
        "SELECT e.id, e.name, e.file_id, f.mime = 'image/gif' AS animated,
                e.created_by, e.created_at
         FROM emojis e JOIN files f ON f.id = e.file_id
         ORDER BY e.name",
    )
    .fetch_all(db)
    .await?)
}

/// Se `id` é um emoji que existe.
pub async fn exists(db: &SqlitePool, id: &str) -> Result<bool, ApiError> {
    Ok(
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM emojis WHERE id = ?)")
            .bind(id)
            .fetch_one(db)
            .await?,
    )
}

fn taken() -> ApiError {
    ApiError::Conflict("Já existe um emoji com esse nome.".into())
}

fn is_unique_violation(error: &sqlx::Error) -> bool {
    matches!(error, sqlx::Error::Database(e) if e.is_unique_violation())
}

pub async fn create(
    db: &SqlitePool,
    actor: &User,
    request: &CreateEmojiRequest,
    now: i64,
) -> Result<Emoji, ApiError> {
    require_permission(db, actor, Permission::ManageEmojis).await?;
    let name = validate_name(&request.name)?;
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM emojis")
        .fetch_one(&mut *tx)
        .await?;
    if count >= EMOJIS_MAX {
        return Err(ApiError::Conflict(
            "O grupo já tem 100 emojis. Exclua um para pôr outro.".into(),
        ));
    }
    let file: Option<(String, i64)> = sqlx::query_as(
        "SELECT mime, size FROM files
         WHERE id = ? AND uploader_id = ? AND kind = 'emoji' AND used_at IS NULL",
    )
    .bind(&request.file_id)
    .bind(&actor.id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((mime, size)) = file else {
        return Err(ApiError::InvalidRequest(
            "Essa imagem não serve para emoji.".into(),
        ));
    };
    if !MIMES.contains(&mime.as_str()) {
        return Err(ApiError::InvalidRequest(
            "O emoji precisa ser PNG, JPEG, WebP ou GIF.".into(),
        ));
    }
    if size > EMOJI_MAX_BYTES {
        return Err(ApiError::InvalidRequest(
            "O emoji pode ter até 256 KB.".into(),
        ));
    }
    let id = Uuid::now_v7().to_string();
    let inserted = sqlx::query(
        "INSERT INTO emojis (id, name, file_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&name)
    .bind(&request.file_id)
    .bind(&actor.id)
    .bind(now)
    .execute(&mut *tx)
    .await;
    match inserted {
        Err(error) if is_unique_violation(&error) => return Err(taken()),
        other => other?,
    };
    crate::files::mark_used(&mut tx, std::slice::from_ref(&request.file_id), now).await?;
    tx.commit().await?;
    Ok(Emoji {
        id,
        name,
        file_id: request.file_id.clone(),
        animated: mime == "image/gif",
        created_by: actor.id.clone(),
        created_at: now,
    })
}

pub async fn rename(
    db: &SqlitePool,
    actor: &User,
    id: &str,
    request: &RenameEmojiRequest,
) -> Result<(), ApiError> {
    require_permission(db, actor, Permission::ManageEmojis).await?;
    let name = validate_name(&request.name)?;
    let done = sqlx::query("UPDATE emojis SET name = ? WHERE id = ?")
        .bind(&name)
        .bind(id)
        .execute(db)
        .await;
    match done {
        Err(error) if is_unique_violation(&error) => Err(taken()),
        Err(error) => Err(error.into()),
        Ok(result) if result.rows_affected() == 0 => Err(not_found()),
        Ok(_) => Ok(()),
    }
}

fn not_found() -> ApiError {
    ApiError::NotFound("Esse emoji não existe mais.".into())
}

/// Exclui o emoji e as reações com ele. Devolve o id do arquivo, para quem chama apagar os bytes.
pub async fn delete(db: &SqlitePool, actor: &User, id: &str) -> Result<String, ApiError> {
    require_permission(db, actor, Permission::ManageEmojis).await?;
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    let file_id: Option<String> = sqlx::query_scalar("SELECT file_id FROM emojis WHERE id = ?")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
    let file_id = file_id.ok_or_else(not_found)?;
    sqlx::query("DELETE FROM reactions WHERE emoji = ?")
        .bind(format!("c:{id}"))
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM emojis WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM files WHERE id = ?")
        .bind(&file_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(file_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn o_nome_tem_de_2_a_32_minusculas_numeros_ou_sublinhado() {
        assert_eq!(validate_name(":kekw:").unwrap(), "kekw");
        assert_eq!(validate_name("gg_2").unwrap(), "gg_2");
        assert!(validate_name("a").is_err());
        assert!(validate_name("KEKW").is_err());
        assert!(validate_name("com espaço").is_err());
        assert!(validate_name(&"a".repeat(33)).is_err());
    }
}
