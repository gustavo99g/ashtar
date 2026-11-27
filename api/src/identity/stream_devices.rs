//! Aparelhos de transmissão (ADR 0038): um portátil, como o Odin 3, que só transmite a tela para onde
//! o dono está, numa sala de voz ou numa ligação privada.
//!
//! Não é o dispositivo do membro ([`super::devices`]): o membro continua com o computador dele, e o
//! aparelho é uma fonte a mais, ligada a ele. O desktop gera um código de pareamento (10 minutos,
//! uma vez só); o aparelho troca o código por um token de sessão próprio. Esse token não passa no
//! [`super::devices::authenticate`] (outra tabela), então o aparelho não chega a nenhuma rota do
//! app: só às rotas `/api/stream-devices/self/*`, pelo extrator `CurrentStreamDevice`.
//!
//! Quem pode parear é quem tem a permissão [`Permission::StreamFromDevice`]; o dono tem todas.
//! Tirar a permissão não derruba o aparelho na hora, mas o próximo token da tela é recusado.

use serde::Serialize;
use sqlx::SqlitePool;
use ts_rs::TS;
use uuid::Uuid;

use super::User;
use super::permissions::{Permission, require_permission};
use crate::error::ApiError;
use crate::secret;

/// Quanto o código de pareamento vale, em segundos.
pub const PAIR_CODE_TTL_SECS: i64 = 10 * 60;

/// Quantos aparelhos uma pessoa pode ter. É proteção da VPS: cada um é uma transmissão a mais.
pub const MAX_DEVICES_PER_USER: i64 = 3;

/// O nome quando o aparelho não manda nenhum.
const DEFAULT_NAME: &str = "Aparelho";

/// Um aparelho pareado, como a lista das Configurações mostra.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS, sqlx::FromRow)]
#[ts(export, export_to = "index.ts")]
pub struct StreamDevice {
    pub id: String,
    #[serde(skip)]
    #[ts(skip)]
    pub user_id: String,
    pub name: String,
    /// Em segundos (Unix).
    pub paired_at: i64,
    /// A última vez que o aparelho falou com a API, em segundos (Unix).
    pub last_seen_at: i64,
}

/// O nome que fica guardado: sem espaços nas pontas, de 1 a 32 caracteres. Vazio vira "Aparelho".
pub fn normalize_name(name: Option<&str>) -> Result<String, ApiError> {
    let name = name.map(str::trim).unwrap_or_default();
    if name.is_empty() {
        return Ok(DEFAULT_NAME.into());
    }
    if name.chars().count() > 32 || name.chars().any(char::is_control) {
        return Err(ApiError::InvalidRequest(
            "O nome do aparelho vai de 1 a 32 caracteres.".into(),
        ));
    }
    Ok(name.to_owned())
}

/// Um código novo para `user` parear um aparelho, no formato `XXXX-XXXX-XXXX`. O código anterior
/// dele, se ainda valia, deixa de valer.
pub async fn create_pair_code(
    db: &SqlitePool,
    user: &User,
    now: i64,
) -> Result<(String, i64), ApiError> {
    require_permission(db, user, Permission::StreamFromDevice).await?;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM stream_devices WHERE user_id = ?")
        .bind(&user.id)
        .fetch_one(db)
        .await?;
    if count >= MAX_DEVICES_PER_USER {
        return Err(ApiError::Conflict(format!(
            "Você já tem {MAX_DEVICES_PER_USER} aparelhos. Desvincule um para parear outro."
        )));
    }
    let code = secret::new_invite_code();
    let normalized = secret::normalize_invite_code(&code).expect("o código gerado é válido");
    let expires_at = now + PAIR_CODE_TTL_SECS;
    let mut tx = db.begin().await?;
    sqlx::query("DELETE FROM stream_pair_codes WHERE user_id = ? OR expires_at <= ?")
        .bind(&user.id)
        .bind(now)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO stream_pair_codes (code_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    )
    .bind(secret::hash(&normalized))
    .bind(&user.id)
    .bind(now)
    .bind(expires_at)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok((code, expires_at))
}

/// O que o pareamento devolve ao aparelho.
pub struct Paired {
    pub owner: User,
    pub device: StreamDevice,
    pub token: String,
}

/// O texto de todo código recusado: não existe, venceu ou já foi usado.
fn invalid_code() -> ApiError {
    ApiError::InvalidRequest(
        "Esse código não vale mais. Gere outro no Ashtar, em Configurações › Voz e vídeo.".into(),
    )
}

/// Troca o código por um aparelho novo e o token da sessão dele. O código vale uma vez só.
pub async fn pair(
    db: &SqlitePool,
    code: &str,
    name: Option<&str>,
    now: i64,
) -> Result<Paired, ApiError> {
    let name = normalize_name(name)?;
    let normalized = secret::normalize_invite_code(code).ok_or_else(invalid_code)?;
    let mut tx = db.begin().await?;
    let user_id: Option<String> = sqlx::query_scalar(
        "DELETE FROM stream_pair_codes WHERE code_hash = ? AND expires_at > ? RETURNING user_id",
    )
    .bind(secret::hash(&normalized))
    .bind(now)
    .fetch_optional(&mut *tx)
    .await?;
    let user_id = user_id.ok_or_else(invalid_code)?;
    let owner: Option<User> = sqlx::query_as(
        "SELECT id, nick, display_name, is_owner, created_at, removed_at, avatar_id
         FROM users WHERE id = ? AND removed_at IS NULL",
    )
    .bind(&user_id)
    .fetch_optional(&mut *tx)
    .await?;
    let owner = owner.ok_or_else(invalid_code)?;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM stream_devices WHERE user_id = ?")
        .bind(&owner.id)
        .fetch_one(&mut *tx)
        .await?;
    if count >= MAX_DEVICES_PER_USER {
        return Err(ApiError::Conflict(format!(
            "Já tem {MAX_DEVICES_PER_USER} aparelhos pareados nesta conta."
        )));
    }
    let token = secret::new_session_token();
    let device = StreamDevice {
        id: short_id(),
        user_id: owner.id.clone(),
        name,
        paired_at: now,
        last_seen_at: now,
    };
    sqlx::query(
        "INSERT INTO stream_devices (id, user_id, name, token_hash, paired_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&device.id)
    .bind(&device.user_id)
    .bind(&device.name)
    .bind(secret::hash(&token))
    .bind(now)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Paired {
        owner,
        device,
        token,
    })
}

/// Um id curto, só letras minúsculas e números: ele vai na identidade da LiveKit
/// (`{dono}:screen-{id}`), que aparece nos logs e não pode ter `:`.
fn short_id() -> String {
    Uuid::new_v4().simple().to_string()[..12].to_owned()
}

/// O aparelho e o dono do token. Atualiza o "visto por último".
pub async fn authenticate(
    db: &SqlitePool,
    token: &str,
    now: i64,
) -> Result<(User, StreamDevice), ApiError> {
    let token_hash = secret::hash(token);
    let device: Option<StreamDevice> = sqlx::query_as(
        "SELECT d.id, d.user_id, d.name, d.paired_at, d.last_seen_at
         FROM stream_devices d JOIN users u ON u.id = d.user_id
         WHERE d.token_hash = ? AND u.removed_at IS NULL",
    )
    .bind(&token_hash)
    .fetch_optional(db)
    .await?;
    let mut device = device.ok_or(ApiError::Unauthenticated)?;
    let owner: User = sqlx::query_as(
        "SELECT id, nick, display_name, is_owner, created_at, removed_at, avatar_id FROM users WHERE id = ?",
    )
    .bind(&device.user_id)
    .fetch_one(db)
    .await?;
    sqlx::query("UPDATE stream_devices SET last_seen_at = ? WHERE id = ?")
        .bind(now)
        .bind(&device.id)
        .execute(db)
        .await?;
    device.last_seen_at = now;
    Ok((owner, device))
}

/// Os aparelhos de `user`, do mais antigo ao mais novo.
pub async fn list(db: &SqlitePool, user: &User) -> Result<Vec<StreamDevice>, ApiError> {
    Ok(sqlx::query_as(
        "SELECT id, user_id, name, paired_at, last_seen_at FROM stream_devices
         WHERE user_id = ? ORDER BY paired_at, id",
    )
    .bind(&user.id)
    .fetch_all(db)
    .await?)
}

/// O aparelho `id` de `user`. O de outra pessoa cai no mesmo 404 de um que não existe.
pub async fn get(db: &SqlitePool, user: &User, id: &str) -> Result<StreamDevice, ApiError> {
    let found: Option<StreamDevice> = sqlx::query_as(
        "SELECT id, user_id, name, paired_at, last_seen_at FROM stream_devices
         WHERE id = ? AND user_id = ?",
    )
    .bind(id)
    .bind(&user.id)
    .fetch_optional(db)
    .await?;
    found.ok_or_else(|| ApiError::NotFound("Esse aparelho não existe.".into()))
}

/// Troca o nome do aparelho `id` de `user`.
pub async fn rename(
    db: &SqlitePool,
    user: &User,
    id: &str,
    name: &str,
) -> Result<StreamDevice, ApiError> {
    let name = normalize_name(Some(name))?;
    let mut device = get(db, user, id).await?;
    sqlx::query("UPDATE stream_devices SET name = ? WHERE id = ?")
        .bind(&name)
        .bind(id)
        .execute(db)
        .await?;
    device.name = name;
    Ok(device)
}

/// Desvincula o aparelho `id` de `user`: o token dele deixa de valer na hora.
pub async fn unlink(db: &SqlitePool, user: &User, id: &str) -> Result<StreamDevice, ApiError> {
    let device = get(db, user, id).await?;
    sqlx::query("DELETE FROM stream_devices WHERE id = ?")
        .bind(id)
        .execute(db)
        .await?;
    Ok(device)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn o_nome_vazio_vira_aparelho_e_o_longo_e_recusado() {
        assert_eq!(normalize_name(None).unwrap(), "Aparelho");
        assert_eq!(normalize_name(Some("   ")).unwrap(), "Aparelho");
        assert_eq!(normalize_name(Some(" Odin 3 ")).unwrap(), "Odin 3");
        assert!(normalize_name(Some(&"a".repeat(33))).is_err());
        assert!(normalize_name(Some("Odin\n3")).is_err());
    }

    #[test]
    fn o_id_curto_cabe_na_identidade() {
        let id = short_id();
        assert_eq!(id.len(), 12);
        assert!(
            id.bytes()
                .all(|b| b.is_ascii_digit() || b.is_ascii_lowercase())
        );
    }
}
