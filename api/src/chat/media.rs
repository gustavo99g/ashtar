//! A mídia do canal (decisão 30 do plano da v0.7): os anexos das mensagens de um canal ou de uma
//! conversa privada, da mensagem mais nova para a mais velha, de 50 em 50. Dois filtros: imagens e
//! vídeos (a grade) e o resto (a lista). A imagem sem miniatura o app mostra como arquivo, então
//! aqui também.

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;

use super::messages::Author;
use crate::error::ApiError;
use crate::files::FileView;

/// Quantos arquivos por página, no máximo. A página termina numa mensagem inteira.
pub const MEDIA_PAGE: usize = 50;
/// Uma mensagem tem até 10 anexos: buscar estes a mais garante uma página que acaba inteira.
const EXTRA: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
pub enum MediaFilter {
    /// Imagens (com miniatura) e vídeos.
    #[default]
    Media,
    /// O resto.
    Files,
}

#[derive(Debug, Default, Deserialize)]
pub struct MediaQuery {
    #[serde(default)]
    pub filter: MediaFilter,
    /// A página seguinte: os arquivos das mensagens mais velhas que esta.
    pub before: Option<String>,
}

/// Um anexo e a mensagem em que ele está.
#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct ChannelFile {
    pub message_id: String,
    pub author: Author,
    #[ts(type = "number")]
    pub created_at: i64,
    pub file: FileView,
}

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct ChannelFilesPage {
    pub files: Vec<ChannelFile>,
    pub has_more: bool,
}

#[derive(FromRow)]
struct Row {
    message_id: String,
    created_at: i64,
    author_id: String,
    nick: String,
    display_name: Option<String>,
    removed_at: Option<i64>,
    avatar_id: Option<String>,
    #[sqlx(flatten)]
    file: FileView,
}

/// Os anexos do canal `channel_id`. Quem chama já conferiu o acesso.
pub async fn list(
    db: &SqlitePool,
    channel_id: &str,
    query: &MediaQuery,
) -> Result<ChannelFilesPage, ApiError> {
    let mut sql = sqlx::QueryBuilder::new(
        "SELECT m.id AS message_id, m.created_at, u.id AS author_id, u.nick, u.display_name,
                u.removed_at, u.avatar_id,
                f.id, f.kind, f.name, f.mime, f.size, f.width, f.height, f.duration_ms,
                f.thumbnail_id
         FROM message_files mf
         JOIN messages m ON m.id = mf.message_id
         JOIN files f ON f.id = mf.file_id
         JOIN users u ON u.id = m.author_id
         WHERE m.channel_id = ",
    );
    sql.push_bind(channel_id);
    let media = "((f.mime LIKE 'image/%' AND f.thumbnail_id IS NOT NULL) OR f.mime LIKE 'video/%')";
    match query.filter {
        MediaFilter::Media => sql.push(format!(" AND {media}")),
        MediaFilter::Files => sql.push(format!(" AND NOT {media}")),
    };
    if let Some(before) = &query.before {
        sql.push(" AND m.id < ").push_bind(before);
    }
    sql.push(" ORDER BY m.id DESC, mf.position LIMIT ")
        .push_bind((MEDIA_PAGE + EXTRA) as i64);
    let mut rows: Vec<Row> = sql.build_query_as().fetch_all(db).await?;

    let has_more = rows.len() > MEDIA_PAGE;
    if has_more {
        // Corta na última mensagem que cabe inteira; a próxima página começa nela.
        let cut = rows[MEDIA_PAGE].message_id.clone();
        rows.truncate(MEDIA_PAGE);
        while rows.last().is_some_and(|row| row.message_id == cut) {
            rows.pop();
        }
    }
    let files = rows
        .into_iter()
        .map(|row| ChannelFile {
            message_id: row.message_id,
            author: Author {
                id: row.author_id,
                nick: row.nick,
                display_name: row.display_name,
                removed: row.removed_at.is_some(),
                avatar: row.avatar_id,
            },
            created_at: row.created_at,
            file: row.file,
        })
        .collect();
    Ok(ChannelFilesPage { files, has_more })
}
