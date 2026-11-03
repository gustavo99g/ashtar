//! Usuários: nick, nome visível, dono, busca, a lista do Painel e remoção.

use serde::Serialize;
use sqlx::{FromRow, SqliteConnection, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use super::User;
use super::invites::Preset;
use super::permissions::{Action, Origin, Permission, require};
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
/// Um membro como a lista do Painel mostra: o computador, o beta, o convite com
/// que entrou e a recuperação que ainda vale.
/// Um membro ativo, como a coluna de membros do chat mostra (`GET /api/people`
/// e o `member.joined` do tempo real). Só o que todo membro pode ver.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct Person {
    pub id: String,
    pub nick: String,
    pub display_name: Option<String>,
    pub is_owner: bool,
    /// Com pelo menos um WebSocket aberto (ou caído há menos de 10 segundos).
    pub online: bool,
}

impl Person {
    pub fn new(user: &User, online: bool) -> Self {
        Self {
            id: user.id.clone(),
            nick: user.nick.clone(),
            display_name: user.display_name.clone(),
            is_owner: user.is_owner,
            online,
        }
    }
}

#[derive(Debug, Clone)]
pub struct MemberDetails {
    pub user: User,
    /// Quando o computador atual foi vinculado; `None` sem computador.
    pub device_linked_at: Option<i64>,
    /// `None` com o beta desligado (e sempre em quem foi removido).
    pub beta: Option<BetaGrant>,
    /// `None` no dono, que criou o grupo.
    pub joined_with: Option<JoinedWith>,
    /// O convite de recuperação para ele que ainda vale, se houver.
    pub pending_recovery: Option<PendingRecovery>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct BetaGrant {
    pub origin: Origin,
    /// Quando o dono ligou; `None` no dono, que sempre tem.
    pub granted_at: Option<i64>,
}

/// O convite novo com que o membro entrou, e quantos já entraram com ele.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct JoinedWith {
    pub invite_id: String,
    pub preset: Option<Preset>,
    pub uses: i64,
    pub max_uses: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct PendingRecovery {
    pub invite_id: String,
    pub expires_at: i64,
}

/// Todos os membros, os removidos inclusive, do mais antigo para o mais novo,
/// com o que o Painel mostra de cada um. Uma consulta só: o app do dono a repete
/// a cada 30 segundos para avisar de quem entrou.
pub async fn list_details(db: &SqlitePool, now: i64) -> Result<Vec<MemberDetails>, ApiError> {
    #[derive(FromRow)]
    struct Row {
        #[sqlx(flatten)]
        user: User,
        device_linked_at: Option<i64>,
        beta_granted_at: Option<i64>,
        joined_invite_id: Option<String>,
        joined_preset: Option<String>,
        joined_uses: Option<i64>,
        joined_max_uses: Option<i64>,
        recovery_invite_id: Option<String>,
        recovery_expires_at: Option<i64>,
    }

    // `pending`: a recuperação que ainda vale para cada membro. Com um `MAX()` só
    // na consulta, o SQLite tira `id` da mesma linha do maior `expires_at`.
    let rows: Vec<Row> = sqlx::query_as(
        "WITH pending AS (
             SELECT r.target_user_id AS user_id, r.id AS invite_id, MAX(r.expires_at) AS expires_at
             FROM invites r
             WHERE r.kind = 'recovery' AND r.revoked_at IS NULL AND r.expires_at > ?1
               AND NOT EXISTS (SELECT 1 FROM invite_uses ru WHERE ru.invite_id = r.id)
             GROUP BY r.target_user_id
         ),
         joined AS (
             SELECT iu.user_id, i.id AS invite_id, i.preset, i.max_uses,
                    (SELECT COUNT(*) FROM invite_uses x WHERE x.invite_id = i.id) AS uses
             FROM invite_uses iu JOIN invites i ON i.id = iu.invite_id
             WHERE i.kind = 'new'
         )
         SELECT u.id, u.nick, u.display_name, u.is_owner, u.created_at, u.removed_at,
                d.linked_at AS device_linked_at,
                p.granted_at AS beta_granted_at,
                j.invite_id AS joined_invite_id, j.preset AS joined_preset,
                j.uses AS joined_uses, j.max_uses AS joined_max_uses,
                pr.invite_id AS recovery_invite_id, pr.expires_at AS recovery_expires_at
         FROM users u
         LEFT JOIN devices d ON d.user_id = u.id
         LEFT JOIN user_permissions p
                ON p.user_id = u.id AND p.permission = ?2 AND u.removed_at IS NULL
         LEFT JOIN joined j ON j.user_id = u.id
         LEFT JOIN pending pr ON pr.user_id = u.id
         ORDER BY u.created_at, u.nick",
    )
    .bind(now)
    .bind(Permission::BetaUpdates.key())
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let beta = if row.user.is_owner {
                Some(BetaGrant {
                    origin: Origin::Owner,
                    granted_at: None,
                })
            } else {
                row.beta_granted_at.map(|at| BetaGrant {
                    origin: Origin::Direct,
                    granted_at: Some(at),
                })
            };
            let joined_with = row.joined_invite_id.map(|invite_id| JoinedWith {
                invite_id,
                preset: row.joined_preset.as_deref().and_then(Preset::from_db),
                uses: row.joined_uses.unwrap_or_default(),
                max_uses: row.joined_max_uses.unwrap_or_default(),
            });
            let pending_recovery = row.recovery_invite_id.zip(row.recovery_expires_at).map(
                |(invite_id, expires_at)| PendingRecovery {
                    invite_id,
                    expires_at,
                },
            );
            MemberDetails {
                user: row.user,
                device_linked_at: row.device_linked_at,
                beta,
                joined_with,
                pending_recovery,
            }
        })
        .collect())
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

/// Cria um membro sem computador e sem convite. Só para o `admin semear`, que
/// enche o banco de desenvolvimento: no grupo de verdade, todo mundo entra por
/// convite.
pub async fn create_seed_member(db: &SqlitePool, nick: &str, now: i64) -> Result<User, ApiError> {
    let nick = validate_nick(nick)?;
    let mut conn = db.acquire().await?;
    insert(&mut conn, &nick, false, now).await
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
