//! Conversas privadas (ADR 0021): um canal de tipo `dm` entre duas pessoas.
//!
//! Um par tem uma conversa só, achada pelo `dm_key` (os dois ids em ordem).
//! Quem é de cada conversa fica em `channel_members`. As mensagens são as de
//! sempre ([`super::messages`]); quem pode ler é a regra de [`super::access`].

use serde::Serialize;
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use super::messages::{self, Author, Message};
use super::read::{self, ReadState};
use crate::error::ApiError;
use crate::identity::{User, users};

/// Uma conversa como o banco guarda: o id e as duas pessoas.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dm {
    pub id: String,
    /// Os ids das duas pessoas, em ordem (a do `dm_key`).
    pub members: [String; 2],
}

impl Dm {
    /// A outra pessoa da conversa, do ponto de vista de `user_id`.
    pub fn other(&self, user_id: &str) -> &str {
        if self.members[0] == user_id {
            &self.members[1]
        } else {
            &self.members[0]
        }
    }

    pub fn has(&self, user_id: &str) -> bool {
        self.members.iter().any(|id| id == user_id)
    }
}

/// Uma conversa como a lista do app mostra, do ponto de vista de quem pede.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct Conversation {
    /// O id do canal: é com ele que se lê e se envia, pelas rotas de mensagem.
    pub id: String,
    /// A outra pessoa. `removed` diz que ela saiu do grupo: a conversa fica só
    /// para leitura.
    pub person: Author,
    /// `None` na conversa recém-aberta, que ainda não tem mensagem.
    pub last_message: Option<Message>,
    /// Até onde quem pede leu, as não lidas, as menções e o silenciar.
    pub state: ReadState,
}

/// A chave do par: os dois ids em ordem, `menor:maior`. É a mesma de qualquer
/// um dos lados.
pub fn dm_key(a: &str, b: &str) -> String {
    if a <= b {
        format!("{a}:{b}")
    } else {
        format!("{b}:{a}")
    }
}

fn from_key(id: String, key: &str) -> Result<Dm, ApiError> {
    let (a, b) = key
        .split_once(':')
        .ok_or_else(|| ApiError::Config(format!("dm_key fora do formato: {key}")))?;
    Ok(Dm {
        id,
        members: [a.to_owned(), b.to_owned()],
    })
}

#[derive(FromRow)]
struct DmRow {
    id: String,
    dm_key: String,
}

/// Abre a conversa de `actor` com `other_id`, ou devolve a que já existe. O
/// `bool` diz se ela é nova.
///
/// Consigo mesmo é `InvalidRequest`; com quem não existe ou saiu do grupo,
/// `NotFound` (a conversa antiga com quem saiu continua na lista, mas não se
/// abre uma nova).
pub async fn open(
    db: &SqlitePool,
    actor: &User,
    other_id: &str,
    now: i64,
) -> Result<(Dm, bool), ApiError> {
    if other_id == actor.id {
        return Err(ApiError::InvalidRequest(
            "Não dá para abrir uma conversa com você mesmo.".into(),
        ));
    }
    let key = dm_key(&actor.id, other_id);
    // Na transação de escrita: dois "Mensagem" ao mesmo tempo, um de cada
    // lado, acham ou criam a mesma conversa.
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    let existing: Option<String> = sqlx::query_scalar("SELECT id FROM channels WHERE dm_key = ?")
        .bind(&key)
        .fetch_optional(&mut *tx)
        .await?;
    if let Some(id) = existing {
        return Ok((from_key(id, &key)?, false));
    }
    let other_active: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM users WHERE id = ? AND removed_at IS NULL")
            .bind(other_id)
            .fetch_optional(&mut *tx)
            .await?;
    if other_active.is_none() {
        return Err(ApiError::NotFound("Essa pessoa não está no grupo.".into()));
    }
    let id = Uuid::now_v7().to_string();
    sqlx::query("INSERT INTO channels (id, kind, created_at, dm_key) VALUES (?, 'dm', ?, ?)")
        .bind(&id)
        .bind(now)
        .bind(&key)
        .execute(&mut *tx)
        .await?;
    for user_id in [actor.id.as_str(), other_id] {
        sqlx::query("INSERT INTO channel_members (channel_id, user_id) VALUES (?, ?)")
            .bind(&id)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok((from_key(id, &key)?, true))
}

/// A conversa `channel_id`, se existe e `user_id` é uma das duas pessoas.
/// Quem não é da conversa recebe o mesmo `None` de um id que não existe.
pub async fn find_for(
    db: &SqlitePool,
    user_id: &str,
    channel_id: &str,
) -> Result<Option<Dm>, ApiError> {
    let row: Option<DmRow> = sqlx::query_as(
        "SELECT c.id, c.dm_key FROM channels c
         JOIN channel_members m ON m.channel_id = c.id
         WHERE c.id = ? AND c.kind = 'dm' AND m.user_id = ?",
    )
    .bind(channel_id)
    .bind(user_id)
    .fetch_optional(db)
    .await?;
    row.map(|row| from_key(row.id, &row.dm_key)).transpose()
}

/// A conversa `channel_id`, sem conferir quem pede. É para o que não vem de uma
/// pessoa (o webhook do LiveKit, o tempo limite da ligação); as rotas usam o
/// [`find_for`].
pub async fn get(db: &SqlitePool, channel_id: &str) -> Result<Option<Dm>, ApiError> {
    let row: Option<DmRow> =
        sqlx::query_as("SELECT id, dm_key FROM channels WHERE id = ? AND kind = 'dm'")
            .bind(channel_id)
            .fetch_optional(db)
            .await?;
    row.map(|row| from_key(row.id, &row.dm_key)).transpose()
}

/// A conversa como `viewer` a vê: a outra pessoa e a última mensagem.
pub async fn view(db: &SqlitePool, dm: &Dm, viewer: &User) -> Result<Conversation, ApiError> {
    let other = users::get_by_id(db, dm.other(&viewer.id)).await?;
    Ok(Conversation {
        id: dm.id.clone(),
        person: Author::of(&other),
        last_message: messages::last(db, &dm.id).await?,
        state: read::state(db, &viewer.id, &dm.id).await?,
    })
}

/// As conversas de `user` que têm pelo menos uma mensagem, da que andou por
/// último para a mais parada. Abrir uma conversa e não escrever nada não a põe
/// na lista de ninguém.
pub async fn list(db: &SqlitePool, user: &User) -> Result<Vec<Conversation>, ApiError> {
    let rows: Vec<DmRow> = sqlx::query_as(
        "SELECT c.id, c.dm_key FROM channels c
         JOIN channel_members m ON m.channel_id = c.id
         WHERE c.kind = 'dm' AND m.user_id = ?
           AND EXISTS (SELECT 1 FROM messages WHERE channel_id = c.id)
         ORDER BY (SELECT MAX(id) FROM messages WHERE channel_id = c.id) DESC",
    )
    .bind(&user.id)
    .fetch_all(db)
    .await?;
    let mut conversations = Vec::with_capacity(rows.len());
    for row in rows {
        let dm = from_key(row.id, &row.dm_key)?;
        conversations.push(view(db, &dm, user).await?);
    }
    Ok(conversations)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_chave_e_a_mesma_dos_dois_lados() {
        assert_eq!(dm_key("b", "a"), "a:b");
        assert_eq!(dm_key("a", "b"), "a:b");
    }

    #[test]
    fn a_outra_pessoa() {
        let dm = from_key("c1".into(), "a:b").unwrap();
        assert_eq!(dm.other("a"), "b");
        assert_eq!(dm.other("b"), "a");
        assert!(dm.has("a") && dm.has("b") && !dm.has("c"));
    }
}
