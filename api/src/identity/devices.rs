//! Dispositivo e sessão.
//!
//! O desktop manda uma chave do dispositivo (o hash do hardware, ou um valor
//! aleatório quando o hardware não serve). A API guarda só o SHA-256 dela.
//! Entrar com a chave devolve um token de sessão, que vai nas chamadas
//! seguintes (`Authorization: Bearer <token>`).
//!
//! A sessão não expira sozinha. Ela cai quando o dispositivo é trocado
//! (convite de recuperação), desvinculado ou o membro é removido: nos três
//! casos a linha do dispositivo é apagada, e a sessão vai junto (cascata).

use sqlx::{SqliteConnection, SqlitePool};
use uuid::Uuid;

use super::User;
use super::permissions::{Action, require};
use crate::error::{ApiError, unique_violation};
use crate::secret;

/// Confere o formato da chave do dispositivo: de 32 a 128 caracteres,
/// letras e números ASCII, `-` e `_` (hexadecimal ou base64url).
pub fn validate_device_key(key: &str) -> Result<(), ApiError> {
    let ok = (32..=128).contains(&key.len())
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if ok {
        Ok(())
    } else {
        Err(ApiError::InvalidDeviceKey)
    }
}

/// Se essa chave já está vinculada a alguém.
pub(super) async fn key_in_use(conn: &mut SqliteConnection, key: &str) -> Result<bool, ApiError> {
    let found: Option<i64> = sqlx::query_scalar("SELECT 1 FROM devices WHERE key_hash = ?")
        .bind(secret::hash(key))
        .fetch_optional(conn)
        .await?;
    Ok(found.is_some())
}

/// Vincula a chave ao usuário, apagando o dispositivo anterior dele (se
/// houver), e abre a sessão. Devolve o token de sessão.
pub(super) async fn link_and_open_session(
    conn: &mut SqliteConnection,
    user_id: &str,
    key: &str,
    now: i64,
) -> Result<String, ApiError> {
    sqlx::query("DELETE FROM devices WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *conn)
        .await?;

    let device_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO devices (id, user_id, key_hash, linked_at) VALUES (?, ?, ?, ?)")
        .bind(&device_id)
        .bind(user_id)
        .bind(secret::hash(key))
        .bind(now)
        .execute(&mut *conn)
        .await
        .map_err(|error| match unique_violation(&error) {
            // A chave já é de outro membro (corrida com outra vinculação).
            Some(_) => ApiError::DeviceAlreadyLinked,
            None => ApiError::from(error),
        })?;

    open_session(conn, &device_id, now).await
}

/// Abre uma sessão para o dispositivo, substituindo a anterior.
async fn open_session(
    conn: &mut SqliteConnection,
    device_id: &str,
    now: i64,
) -> Result<String, ApiError> {
    sqlx::query("DELETE FROM sessions WHERE device_id = ?")
        .bind(device_id)
        .execute(&mut *conn)
        .await?;

    let token = secret::new_session_token();
    sqlx::query(
        "INSERT INTO sessions (token_hash, device_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
    )
    .bind(secret::hash(&token))
    .bind(device_id)
    .bind(now)
    .bind(now)
    .execute(&mut *conn)
    .await?;
    Ok(token)
}

/// Entra com a chave de um dispositivo já vinculado. Devolve o usuário e um
/// token de sessão novo (o anterior deixa de valer).
pub async fn login(db: &SqlitePool, key: &str, now: i64) -> Result<(User, String), ApiError> {
    validate_device_key(key)?;

    let mut tx = db.begin().await?;
    let found: Option<(String, String)> = sqlx::query_as(
        "SELECT d.id, d.user_id FROM devices d JOIN users u ON u.id = d.user_id
         WHERE d.key_hash = ? AND u.removed_at IS NULL",
    )
    .bind(secret::hash(key))
    .fetch_optional(&mut *tx)
    .await?;
    let Some((device_id, user_id)) = found else {
        return Err(ApiError::UnknownDevice);
    };

    let token = open_session(&mut tx, &device_id, now).await?;
    let user = sqlx::query_as(
        "SELECT id, nick, display_name, is_owner, created_at, removed_at, avatar_id FROM users WHERE id = ?",
    )
    .bind(&user_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok((user, token))
}

/// O membro dono do token de sessão. Atualiza o "visto por último".
pub async fn authenticate(db: &SqlitePool, token: &str, now: i64) -> Result<User, ApiError> {
    let token_hash = secret::hash(token);
    let user: Option<User> = sqlx::query_as(
        "SELECT u.id, u.nick, u.display_name, u.is_owner, u.created_at, u.removed_at, u.avatar_id
         FROM sessions s
         JOIN devices d ON d.id = s.device_id
         JOIN users u ON u.id = d.user_id
         WHERE s.token_hash = ? AND u.removed_at IS NULL",
    )
    .bind(&token_hash)
    .fetch_optional(db)
    .await?;
    let user = user.ok_or(ApiError::Unauthenticated)?;

    sqlx::query("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?")
        .bind(now)
        .bind(&token_hash)
        .execute(db)
        .await?;
    Ok(user)
}

/// Se o membro tem um dispositivo vinculado.
pub async fn has_device(db: &SqlitePool, user: &User) -> Result<bool, ApiError> {
    let found: Option<i64> = sqlx::query_scalar("SELECT 1 FROM devices WHERE user_id = ?")
        .bind(&user.id)
        .fetch_optional(db)
        .await?;
    Ok(found.is_some())
}

/// Desvincula o dispositivo do membro (e derruba a sessão). Para voltar, ele
/// precisa de um convite de recuperação.
pub async fn unlink(db: &SqlitePool, actor: &User, target: &User) -> Result<(), ApiError> {
    require(actor, Action::UnlinkDevice)?;
    let result = sqlx::query("DELETE FROM devices WHERE user_id = ?")
        .bind(&target.id)
        .execute(db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound(format!(
            "{} não tem dispositivo vinculado.",
            target.nick
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formato_da_chave() {
        assert!(validate_device_key(&"a".repeat(64)).is_ok());
        assert!(validate_device_key("curta").is_err());
        assert!(validate_device_key(&"a".repeat(129)).is_err());
        assert!(validate_device_key(&format!("{}!", "a".repeat(40))).is_err());
    }
}
