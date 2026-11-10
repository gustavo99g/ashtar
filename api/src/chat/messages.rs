//! Mensagens: o texto que vale, o envio sem duplicar e o histórico em páginas.

use serde::Serialize;
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use super::access::Readable;
use super::{mentions, read};
use crate::error::{ApiError, unique_violation};
use crate::identity::User;
use crate::limiter::SendLimiter;

pub const BODY_MAX: usize = 2000;
/// Quebras de linha seguidas que ainda valem.
const MAX_BLANK_RUN: usize = 5;
pub const CLIENT_ID_MAX: usize = 64;
pub const PAGE_DEFAULT: i64 = 50;
pub const PAGE_MAX: i64 = 100;
/// O que a volta de uma reconexão busca de uma vez (`after`).
pub const CATCH_UP_MAX: i64 = 200;

/// Quem escreveu, como a mensagem leva junto: quem não é dono não lê a lista
/// do Painel, então o app não teria de onde tirar o nome.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct Author {
    pub id: String,
    pub nick: String,
    pub display_name: Option<String>,
    /// Saiu do grupo: o app mostra "(saiu do grupo)" ao lado do nome.
    pub removed: bool,
}

/// Uma mensagem como a API devolve e o WebSocket leva.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct Message {
    pub id: String,
    pub channel_id: String,
    pub client_id: String,
    pub author: Author,
    pub body: String,
    /// Os ids de quem a mensagem menciona (`@nick`), achados pela API no envio.
    pub mentions: Vec<String>,
    pub created_at: i64,
}

#[derive(FromRow)]
struct MessageRow {
    id: String,
    channel_id: String,
    client_id: String,
    body: String,
    created_at: i64,
    author_id: String,
    nick: String,
    display_name: Option<String>,
    removed_at: Option<i64>,
    /// Os ids mencionados, separados por vírgula; `NULL` sem menção.
    mentions: Option<String>,
}

impl From<MessageRow> for Message {
    fn from(row: MessageRow) -> Self {
        Self {
            id: row.id,
            channel_id: row.channel_id,
            client_id: row.client_id,
            author: Author {
                id: row.author_id,
                nick: row.nick,
                display_name: row.display_name,
                removed: row.removed_at.is_some(),
            },
            body: row.body,
            mentions: split_mentions(row.mentions.as_deref()),
            created_at: row.created_at,
        }
    }
}

/// O `group_concat` não promete ordem: os ids saem ordenados, para a mesma
/// mensagem vir sempre igual.
fn split_mentions(joined: Option<&str>) -> Vec<String> {
    let mut ids: Vec<String> = joined
        .into_iter()
        .flat_map(|joined| joined.split(','))
        .map(str::to_owned)
        .collect();
    ids.sort();
    ids
}

/// O `SELECT` de [`MessageRow`], com o autor, seguido do resto da consulta.
macro_rules! select_message {
    ($rest:literal) => {
        concat!(
            "SELECT m.id, m.channel_id, m.client_id, m.body, m.created_at,
                    u.id AS author_id, u.nick, u.display_name, u.removed_at,
                    (SELECT group_concat(x.user_id) FROM mentions x
                      WHERE x.message_id = m.id) AS mentions
             FROM messages m JOIN users u ON u.id = m.author_id ",
            $rest
        )
    };
}

/// Confere o texto e devolve a versão sem espaços nas pontas.
///
/// Regras: de 1 a 2.000 caracteres depois do `trim`; quebras de linha valem,
/// mas no máximo 5 seguidas.
pub fn validate_body(input: &str) -> Result<String, ApiError> {
    let body = input.trim();
    if body.is_empty() {
        return Err(ApiError::InvalidRequest("A mensagem está vazia.".into()));
    }
    if body.chars().count() > BODY_MAX {
        return Err(ApiError::InvalidRequest(
            "A mensagem pode ter até 2.000 caracteres.".into(),
        ));
    }
    let newlines = "\n".repeat(MAX_BLANK_RUN + 1);
    if body.replace("\r\n", "\n").contains(&newlines) {
        return Err(ApiError::InvalidRequest(
            "Use no máximo 5 quebras de linha seguidas.".into(),
        ));
    }
    Ok(body.to_owned())
}

/// O `client_id` vem do app: de 1 a 64 caracteres visíveis.
pub fn validate_client_id(input: &str) -> Result<(), ApiError> {
    let ok =
        (1..=CLIENT_ID_MAX).contains(&input.len()) && input.bytes().all(|b| b.is_ascii_graphic());
    if ok {
        Ok(())
    } else {
        Err(ApiError::InvalidRequest("O client_id não é válido.".into()))
    }
}

/// Grava a mensagem de `author` em `channel`, que já passou pela regra de
/// leitura ([`super::access::readable`]). O mesmo `client_id` do mesmo autor
/// devolve a mensagem que já existe, sem gravar outra: o "Tentar de novo" do app
/// nunca duplica. O `bool` diz se ela é nova.
///
/// A ordem importa: o texto inválido é recusado antes de contar no `limiter`, e
/// um reenvio de mensagem já gravada também não conta (nem leva 429).
///
/// Na mesma transação da mensagem vão as menções dela e o ponteiro de lido de
/// quem escreveu: escrever no canal é ter lido até ali.
pub async fn create(
    db: &SqlitePool,
    limiter: &SendLimiter,
    channel: &Readable,
    author: &User,
    client_id: &str,
    body: &str,
    now: i64,
) -> Result<(Message, bool), ApiError> {
    validate_client_id(client_id)?;
    let body = validate_body(body)?;
    let channel_id = channel.id();

    if let Some(existing) = find_existing(db, channel_id, author, client_id).await? {
        return Ok((existing, false));
    }
    limiter.try_send(&author.id)?;
    let mentioned = mentions::resolve(db, channel, author, &body).await?;

    let id = Uuid::now_v7().to_string();
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    let inserted = sqlx::query(
        "INSERT INTO messages (id, channel_id, author_id, client_id, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(channel_id)
    .bind(&author.id)
    .bind(client_id)
    .bind(&body)
    .bind(now)
    .execute(&mut *tx)
    .await;

    match inserted {
        Ok(_) => {}
        // Dois envios iguais ao mesmo tempo: o segundo perde a corrida e
        // devolve o primeiro.
        Err(error) if unique_violation(&error).is_some() => {
            drop(tx);
            let existing = find_existing(db, channel_id, author, client_id).await?;
            return existing
                .map(|m| (m, false))
                .ok_or(ApiError::Internal(error));
        }
        Err(error) => return Err(error.into()),
    }
    for user_id in &mentioned {
        sqlx::query("INSERT INTO mentions (message_id, user_id, channel_id) VALUES (?, ?, ?)")
            .bind(&id)
            .bind(user_id)
            .bind(channel_id)
            .execute(&mut *tx)
            .await?;
    }
    read::advance(&mut tx, &author.id, channel_id, &id).await?;
    tx.commit().await?;
    Ok((get(db, &id).await?, true))
}

/// A mensagem que `author` já gravou com esse `client_id`. Se ela está em
/// outro canal, o app reaproveitou o id por engano: `Conflict`, em vez de
/// devolver como se fosse deste canal.
async fn find_existing(
    db: &SqlitePool,
    channel_id: &str,
    author: &User,
    client_id: &str,
) -> Result<Option<Message>, ApiError> {
    let row: Option<MessageRow> =
        sqlx::query_as(select_message!("WHERE m.author_id = ? AND m.client_id = ?"))
            .bind(&author.id)
            .bind(client_id)
            .fetch_optional(db)
            .await?;
    match row.map(Message::from) {
        Some(message) if message.channel_id != channel_id => Err(ApiError::Conflict(
            "Esse client_id já foi usado em outro canal.".into(),
        )),
        found => Ok(found),
    }
}

async fn get(db: &SqlitePool, id: &str) -> Result<Message, ApiError> {
    let row: MessageRow = sqlx::query_as(select_message!("WHERE m.id = ?"))
        .bind(id)
        .fetch_one(db)
        .await?;
    Ok(row.into())
}

/// A última mensagem do canal `channel_id`, se ele tem alguma. É o que a lista
/// de conversas mostra embaixo do nome.
pub async fn last(db: &SqlitePool, channel_id: &str) -> Result<Option<Message>, ApiError> {
    let row: Option<MessageRow> = sqlx::query_as(select_message!(
        "WHERE m.channel_id = ? ORDER BY m.id DESC LIMIT 1"
    ))
    .bind(channel_id)
    .fetch_optional(db)
    .await?;
    Ok(row.map(Message::from))
}

/// Uma página do histórico.
#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct MessagePage {
    /// Da mais antiga para a mais nova, na ordem em que a tela desenha.
    pub messages: Vec<Message>,
    /// Se há mais mensagens além desta página (antes, no `before`; depois, no
    /// `after`).
    pub has_more: bool,
}

/// O sentido da página.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Cursor {
    /// As mais novas do canal.
    Latest,
    /// As anteriores a este id (rolar para cima).
    Before(String),
    /// As que chegaram depois deste id (a volta de uma reconexão).
    After(String),
}

/// Até `limit` mensagens do canal `channel_id` no sentido de `cursor`.
pub async fn page(
    db: &SqlitePool,
    channel_id: &str,
    cursor: Cursor,
    limit: i64,
) -> Result<MessagePage, ApiError> {
    // Uma a mais diz se há outra página, sem um `COUNT`.
    let fetch = limit + 1;
    let mut rows: Vec<MessageRow> = match &cursor {
        Cursor::Latest => {
            sqlx::query_as(select_message!(
                "WHERE m.channel_id = ? ORDER BY m.id DESC LIMIT ?"
            ))
            .bind(channel_id)
            .bind(fetch)
            .fetch_all(db)
            .await?
        }
        Cursor::Before(id) => {
            sqlx::query_as(select_message!(
                "WHERE m.channel_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?"
            ))
            .bind(channel_id)
            .bind(id)
            .bind(fetch)
            .fetch_all(db)
            .await?
        }
        Cursor::After(id) => {
            sqlx::query_as(select_message!(
                "WHERE m.channel_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT ?"
            ))
            .bind(channel_id)
            .bind(id)
            .bind(fetch)
            .fetch_all(db)
            .await?
        }
    };
    let has_more = rows.len() as i64 > limit;
    rows.truncate(limit as usize);
    if !matches!(cursor, Cursor::After(_)) {
        rows.reverse();
    }
    Ok(MessagePage {
        messages: rows.into_iter().map(Message::from).collect(),
        has_more,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn texto_valido_perde_os_espacos_das_pontas() {
        assert_eq!(validate_body("  oi  ").unwrap(), "oi");
        assert_eq!(
            validate_body("linha 1\nlinha 2").unwrap(),
            "linha 1\nlinha 2"
        );
        assert!(validate_body(&"a".repeat(BODY_MAX)).is_ok());
        // Conta caracteres, não bytes.
        assert!(validate_body(&"é".repeat(BODY_MAX)).is_ok());
    }

    #[test]
    fn texto_invalido() {
        assert!(validate_body("").is_err());
        assert!(validate_body(" \n\t ").is_err());
        assert!(validate_body(&"a".repeat(BODY_MAX + 1)).is_err());
        assert!(validate_body(&format!("a{}b", "\n".repeat(6))).is_err());
        assert!(validate_body(&format!("a{}b", "\r\n".repeat(6))).is_err());
        assert!(validate_body(&format!("a{}b", "\n".repeat(5))).is_ok());
    }

    #[test]
    fn client_id() {
        assert!(validate_client_id("0b9a2f4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b").is_ok());
        assert!(validate_client_id("").is_err());
        assert!(validate_client_id("com espaço").is_err());
        assert!(validate_client_id(&"a".repeat(CLIENT_ID_MAX + 1)).is_err());
    }
}
