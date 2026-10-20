//! Usuários: nick, dono, busca e remoção.

use sqlx::{SqliteConnection, SqlitePool};
use uuid::Uuid;

use super::User;
use super::permissions::{Action, require};
use crate::error::{ApiError, unique_violation};

const NICK_MIN: usize = 2;
const NICK_MAX: usize = 32;
const DISPLAY_NAME_MAX: usize = 32;

/// `SELECT` das colunas de [`User`], seguido do resto da consulta. Uma macro e
/// não um `format!`: o sqlx só aceita SQL que é texto fixo no código.
macro_rules! select_user {
    ($rest:literal) => {
        concat!(
            "SELECT id, nick, display_name, is_owner, created_at, removed_at FROM users ",
            $rest
        )
    };
}

/// Confere o nick e devolve a versão sem espaços nas pontas.
///
/// Regras: de 2 a 32 caracteres; letras (com acento), números, espaço, `_`,
/// `-` e `.`; sem dois espaços seguidos.
pub fn validate_nick(input: &str) -> Result<String, ApiError> {
    let nick = input.trim();
    let len = nick.chars().count();

    if !(NICK_MIN..=NICK_MAX).contains(&len) {
        return Err(ApiError::InvalidNick(
            "O nick precisa ter de 2 a 32 caracteres.",
        ));
    }
    if !nick.chars().all(allowed_char) {
        return Err(ApiError::InvalidNick(
            "Use só letras, números, espaço, _, - e ponto no nick.",
        ));
    }
    if nick.contains("  ") {
        return Err(ApiError::InvalidNick(
            "O nick não pode ter dois espaços seguidos.",
        ));
    }
    Ok(nick.to_owned())
}

/// Os caracteres que valem no nick e no nome visível.
fn allowed_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, ' ' | '_' | '-' | '.')
}

/// Confere o nome visível e devolve a versão sem espaços nas pontas, ou `None`
/// quando ele fica em branco (aí aparece o nick).
///
/// Regras: as do nick, menos o mínimo de 2 caracteres e ser único. De 1 a 32
/// caracteres; letras (com acento), números, espaço, `_`, `-` e `.`; sem dois
/// espaços seguidos.
pub fn validate_display_name(input: &str) -> Result<Option<String>, ApiError> {
    let name = input.trim();
    if name.is_empty() {
        return Ok(None);
    }
    if name.chars().count() > DISPLAY_NAME_MAX {
        return Err(ApiError::InvalidDisplayName(
            "O nome visível pode ter até 32 caracteres.",
        ));
    }
    if !name.chars().all(allowed_char) {
        return Err(ApiError::InvalidDisplayName(
            "Use só letras, números, espaço, _, - e ponto no nome visível.",
        ));
    }
    if name.contains("  ") {
        return Err(ApiError::InvalidDisplayName(
            "O nome visível não pode ter dois espaços seguidos.",
        ));
    }
    Ok(Some(name.to_owned()))
}

/// Membro ativo com esse nick (sem diferenciar maiúscula de minúscula).
pub async fn find_active_by_nick(db: &SqlitePool, nick: &str) -> Result<Option<User>, ApiError> {
    let sql = select_user!("WHERE nick = ? COLLATE NOCASE AND removed_at IS NULL");
    Ok(sqlx::query_as(sql)
        .bind(nick.trim())
        .fetch_optional(db)
        .await?)
}

/// Como [`find_active_by_nick`], mas "não encontrado" vira erro.
pub async fn get_active_by_nick(db: &SqlitePool, nick: &str) -> Result<User, ApiError> {
    find_active_by_nick(db, nick)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("Nenhum membro ativo com o nick \"{nick}\".")))
}

/// O usuário com esse id, removido ou não.
pub async fn find_by_id(db: &SqlitePool, id: &str) -> Result<Option<User>, ApiError> {
    let sql = select_user!("WHERE id = ?");
    Ok(sqlx::query_as(sql).bind(id).fetch_optional(db).await?)
}

/// Como [`find_by_id`], mas "não encontrado" vira erro. As rotas do Painel
/// falam dos membros pelo id; o `admin` continua buscando pelo nick.
pub async fn get_by_id(db: &SqlitePool, id: &str) -> Result<User, ApiError> {
    find_by_id(db, id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Nenhum membro com esse id.".into()))
}

/// O dono, se já existir.
pub async fn find_owner(db: &SqlitePool) -> Result<Option<User>, ApiError> {
    let sql = select_user!("WHERE is_owner = 1");
    Ok(sqlx::query_as(sql).fetch_optional(db).await?)
}

/// Todos os usuários, removidos inclusive, do mais antigo para o mais novo.
pub async fn list(db: &SqlitePool) -> Result<Vec<User>, ApiError> {
    let sql = select_user!("ORDER BY created_at, nick");
    Ok(sqlx::query_as(sql).fetch_all(db).await?)
}

/// Se o nick está livre entre os membros ativos.
pub(super) async fn nick_available(
    conn: &mut SqliteConnection,
    nick: &str,
) -> Result<bool, ApiError> {
    let taken: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM users WHERE nick = ? COLLATE NOCASE AND removed_at IS NULL",
    )
    .bind(nick)
    .fetch_optional(conn)
    .await?;
    Ok(taken.is_none())
}

/// Grava um usuário novo e o devolve.
pub(super) async fn insert(
    conn: &mut SqliteConnection,
    nick: &str,
    is_owner: bool,
    now: i64,
) -> Result<User, ApiError> {
    if !nick_available(conn, nick).await? {
        return Err(ApiError::NickTaken);
    }
    let user = User {
        id: Uuid::new_v4().to_string(),
        nick: nick.to_owned(),
        display_name: None,
        is_owner,
        created_at: now,
        removed_at: None,
    };
    sqlx::query("INSERT INTO users (id, nick, is_owner, created_at) VALUES (?, ?, ?, ?)")
        .bind(&user.id)
        .bind(&user.nick)
        .bind(user.is_owner)
        .bind(user.created_at)
        .execute(conn)
        .await
        .map_err(|error| match unique_violation(&error) {
            // Corrida entre duas inserções: o índice único é a última barreira.
            Some(message) if message.contains("is_owner") => {
                ApiError::Conflict("O dono já existe.".into())
            }
            Some(_) => ApiError::NickTaken,
            None => ApiError::from(error),
        })?;
    Ok(user)
}

/// Cria o dono. Só pelo `admin`, e só uma vez.
pub async fn create_owner(db: &SqlitePool, nick: &str, now: i64) -> Result<User, ApiError> {
    let nick = validate_nick(nick)?;
    if find_owner(db).await?.is_some() {
        return Err(ApiError::Conflict("O dono já existe.".into()));
    }
    let mut conn = db.acquire().await?;
    insert(&mut conn, &nick, true, now).await
}

/// Troca o nome visível do próprio membro. Texto vazio ou `None` volta para o
/// nick. Devolve o membro já com o nome novo.
pub async fn set_display_name(
    db: &SqlitePool,
    user: &User,
    input: Option<&str>,
) -> Result<User, ApiError> {
    let display_name = validate_display_name(input.unwrap_or_default())?;
    let updated =
        sqlx::query("UPDATE users SET display_name = ? WHERE id = ? AND removed_at IS NULL")
            .bind(&display_name)
            .bind(&user.id)
            .execute(db)
            .await?;
    if updated.rows_affected() == 0 {
        return Err(ApiError::Unauthenticated);
    }
    Ok(User {
        display_name,
        ..user.clone()
    })
}

/// Remove um membro: marca como removido, apaga o dispositivo (e a sessão,
/// em cascata) e revoga os convites de recuperação pendentes para ele. O
/// histórico de convites continua apontando para ele.
pub async fn remove(
    db: &SqlitePool,
    actor: &User,
    target: &User,
    now: i64,
) -> Result<(), ApiError> {
    require(actor, Action::RemoveMember)?;
    if target.is_owner {
        return Err(ApiError::Conflict("O dono não pode ser removido.".into()));
    }

    let mut tx = db.begin().await?;
    let updated =
        sqlx::query("UPDATE users SET removed_at = ? WHERE id = ? AND removed_at IS NULL")
            .bind(now)
            .bind(&target.id)
            .execute(&mut *tx)
            .await?;
    if updated.rows_affected() == 0 {
        return Err(ApiError::Conflict(format!(
            "{} já foi removido.",
            target.nick
        )));
    }
    sqlx::query("DELETE FROM devices WHERE user_id = ?")
        .bind(&target.id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "UPDATE invites SET revoked_at = ?
         WHERE target_user_id = ? AND revoked_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM invite_uses iu WHERE iu.invite_id = invites.id)",
    )
    .bind(now)
    .bind(&target.id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nick_valido_vem_sem_espacos_nas_pontas() {
        assert_eq!(validate_nick("  Kid  ").unwrap(), "Kid");
        assert_eq!(validate_nick("João.Silva_2").unwrap(), "João.Silva_2");
        assert_eq!(validate_nick("Dois Nomes").unwrap(), "Dois Nomes");
    }

    #[test]
    fn nome_visivel_em_branco_volta_para_o_nick() {
        assert_eq!(validate_display_name("").unwrap(), None);
        assert_eq!(validate_display_name("   ").unwrap(), None);
        assert_eq!(
            validate_display_name("  juju ").unwrap().as_deref(),
            Some("juju")
        );
        // Diferente do nick, 1 caractere basta.
        assert_eq!(validate_display_name("J").unwrap().as_deref(), Some("J"));
        assert_eq!(
            validate_display_name(&"é".repeat(32)).unwrap().as_deref(),
            Some("é".repeat(32).as_str())
        );
    }

    #[test]
    fn nome_visivel_invalido() {
        for bad in [
            "emoji 😀",
            "dois  espacos",
            "<b>oi</b>",
            "a\tb",
            &"a".repeat(33),
        ] {
            assert!(
                matches!(
                    validate_display_name(bad),
                    Err(ApiError::InvalidDisplayName(_))
                ),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn nick_invalido() {
        assert!(validate_nick("a").is_err());
        assert!(validate_nick(&"a".repeat(33)).is_err());
        assert!(validate_nick("emoji 😀").is_err());
        assert!(validate_nick("dois  espacos").is_err());
        assert!(validate_nick("<script>").is_err());
    }
}
