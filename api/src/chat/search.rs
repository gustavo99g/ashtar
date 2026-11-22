//! A busca nas mensagens (decisões 25 a 27 do plano da v0.7): o FTS5 sobre o texto e os nomes dos
//! anexos, só nos canais de texto que a pessoa lê. As conversas privadas ficam de fora (o Kid
//! decidiu, 20/11).

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;

use super::access::{self, Readable};
use super::channels::Channel;
use super::messages::{self, Message};
use crate::error::ApiError;
use crate::identity::User;

/// Quantos resultados por página.
pub const SEARCH_PAGE: i64 = 25;

/// O que a mensagem tem (`tem:`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
pub enum SearchHas {
    /// Qualquer anexo.
    Attachment,
    Image,
    Video,
    Link,
}

/// O pedido de uma busca. Os filtros que a pessoa digita (`de:`, `em:`, `tem:`) o app separa.
#[derive(Debug, Default, Deserialize)]
pub struct SearchQuery {
    /// As palavras. Cada uma acha também o começo de uma palavra maior ("jog" acha "jogar").
    pub q: Option<String>,
    /// Só neste canal (`em:#canal`).
    pub channel_id: Option<String>,
    /// Só de quem tem este nick (`de:nick`).
    pub author: Option<String>,
    pub has: Option<SearchHas>,
    /// A página seguinte: as mais velhas que esta mensagem.
    pub before: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct SearchPage {
    /// Da mais nova para a mais velha.
    pub messages: Vec<Message>,
    pub has_more: bool,
}

/// As palavras no formato do FTS5: cada uma entre aspas (nada vira operador) e com `*` (acha o
/// começo). `None` se não sobrou palavra.
pub fn fts_query(text: &str) -> Option<String> {
    let words: Vec<String> = text
        .split_whitespace()
        .map(|word| word.replace('"', ""))
        .filter(|word| !word.is_empty())
        .take(10)
        .map(|word| format!("\"{word}\"*"))
        .collect();
    (!words.is_empty()).then(|| words.join(" "))
}

/// Os canais de texto abertos que `user` lê.
async fn readable_channels(db: &SqlitePool, user: &User) -> Result<Vec<String>, ApiError> {
    let channels: Vec<Channel> =
        sqlx::query_as("SELECT * FROM channels WHERE kind = 'text' AND archived_at IS NULL")
            .fetch_all(db)
            .await?;
    let mut ids = Vec::new();
    for channel in channels {
        if access::can_access(db, user, &channel).await? {
            ids.push(channel.id);
        }
    }
    Ok(ids)
}

pub async fn search(
    db: &SqlitePool,
    user: &User,
    query: &SearchQuery,
) -> Result<SearchPage, ApiError> {
    let words = query.q.as_deref().and_then(fts_query);
    let author = query
        .author
        .as_deref()
        .map(str::trim)
        .filter(|a| !a.is_empty());
    if words.is_none() && author.is_none() && query.has.is_none() {
        return Err(ApiError::InvalidRequest("Escreva o que buscar.".into()));
    }
    let channels = match &query.channel_id {
        Some(id) => match access::readable(db, user, id).await? {
            Readable::Text(channel) => vec![channel.id],
            // As conversas privadas não entram na busca.
            Readable::Dm(_) => {
                return Err(ApiError::NotFound(
                    "Esse canal não existe ou foi arquivado.".into(),
                ));
            }
        },
        None => readable_channels(db, user).await?,
    };
    if channels.is_empty() {
        return Ok(SearchPage {
            messages: Vec::new(),
            has_more: false,
        });
    }

    let mut sql = sqlx::QueryBuilder::new(
        "SELECT m.id FROM messages m JOIN users u ON u.id = m.author_id
         WHERE m.kind = 'text' AND m.channel_id IN (",
    );
    let mut list = sql.separated(", ");
    for id in &channels {
        list.push_bind(id);
    }
    sql.push(")");
    if let Some(words) = &words {
        sql.push(" AND m.id IN (SELECT message_id FROM messages_fts WHERE messages_fts MATCH ")
            .push_bind(words)
            .push(")");
    }
    if let Some(author) = author {
        sql.push(" AND u.nick = ")
            .push_bind(author.trim_start_matches('@'))
            .push(" COLLATE NOCASE");
    }
    match query.has {
        None => {}
        Some(SearchHas::Attachment) => {
            sql.push(" AND EXISTS (SELECT 1 FROM message_files mf WHERE mf.message_id = m.id)");
        }
        Some(kind @ (SearchHas::Image | SearchHas::Video)) => {
            sql.push(
                " AND EXISTS (SELECT 1 FROM message_files mf JOIN files f ON f.id = mf.file_id
                   WHERE mf.message_id = m.id AND f.mime LIKE ",
            )
            .push_bind(if kind == SearchHas::Image {
                "image/%"
            } else {
                "video/%"
            })
            .push(")");
        }
        Some(SearchHas::Link) => {
            sql.push(" AND (m.body LIKE '%http://%' OR m.body LIKE '%https://%')");
        }
    }
    if let Some(before) = &query.before {
        sql.push(" AND m.id < ").push_bind(before);
    }
    sql.push(" ORDER BY m.id DESC LIMIT ")
        .push_bind(SEARCH_PAGE + 1);
    let mut ids: Vec<String> = sql.build_query_scalar().fetch_all(db).await?;
    let has_more = ids.len() as i64 > SEARCH_PAGE;
    ids.truncate(SEARCH_PAGE as usize);
    Ok(SearchPage {
        messages: messages::by_ids(db, &ids).await?,
        has_more,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn as_palavras_viram_prefixos_entre_aspas() {
        assert_eq!(
            fts_query("bora jogar").as_deref(),
            Some("\"bora\"* \"jogar\"*")
        );
        assert_eq!(
            fts_query("a\"b OR c").as_deref(),
            Some("\"ab\"* \"OR\"* \"c\"*")
        );
        assert_eq!(fts_query("   "), None);
    }
}
