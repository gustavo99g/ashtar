//! Mensagens: o texto que vale, o envio sem duplicar e o histórico em páginas.

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use super::access::Readable;
use super::{mentions, read};
use crate::calls::{CallOutcome, CallRecord};
use crate::error::{ApiError, unique_violation};
use crate::files::{self, FileView};
use crate::identity::User;
use crate::limiter::SendLimiter;
use crate::previews::{self, LinkPreview};

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
    /// O id do arquivo da foto de perfil, ou `null` (ADR 0031).
    #[ts(optional = nullable)]
    pub avatar: Option<String>,
}

impl Author {
    pub fn of(user: &User) -> Self {
        Self {
            id: user.id.clone(),
            nick: user.nick.clone(),
            display_name: user.display_name.clone(),
            removed: !user.is_active(),
            avatar: user.avatar_id.clone(),
        }
    }
}

/// O tipo da mensagem: o texto de alguém, ou o registro de uma ligação.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
pub enum MessageKind {
    Text,
    /// O registro de uma ligação (ADR 0023), de quem ligou. O `body` é
    /// "Ligação", para o app antigo; o que vale é o `call`.
    Call,
}

/// O texto do registro de ligação, que é o que um app antigo mostra.
pub const CALL_BODY: &str = "Ligação";

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
    pub kind: MessageKind,
    /// Só no `kind = "call"`: como a ligação acabou e quanto durou.
    pub call: Option<CallRecord>,
    /// Quando o autor editou o texto pela última vez (ADR 0032).
    pub edited_at: Option<i64>,
    /// A mensagem respondida, se esta é uma resposta.
    pub reply_to: Option<ReplyRef>,
    /// As reações, na ordem da primeira de cada emoji.
    pub reactions: Vec<Reaction>,
    /// Quando foi fixada, se está.
    pub pinned_at: Option<i64>,
    /// Os anexos, na ordem em que foram escolhidos (até [`ATTACHMENTS_MAX`]).
    pub attachments: Vec<FileView>,
    /// Os cartões dos links do texto (até 3), que chegam depois, num `message.updated`.
    pub previews: Vec<LinkPreview>,
    /// De onde veio, se foi encaminhada (decisão 29 do plano da v0.7).
    pub forwarded: Option<ForwardedFrom>,
}

/// O resumo da original de uma mensagem encaminhada, guardado na hora: a encaminhada continua
/// igual se a original mudar ou for excluída.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct ForwardedFrom {
    pub message_id: String,
    pub author_id: String,
    /// O nome de quem escreveu, como aparecia.
    pub author_name: String,
    /// O canal da original (`#nome`); `None` numa conversa privada.
    pub channel_name: Option<String>,
    pub created_at: i64,
}

/// Quantos arquivos uma mensagem leva.
pub const ATTACHMENTS_MAX: usize = 10;

/// A mensagem que o envio responde, e se a resposta menciona quem a escreveu
/// (o `@` ligado, o padrão do app).
#[derive(Debug, Clone, Copy)]
pub struct ReplyTo<'a> {
    pub id: &'a str,
    pub mention: bool,
}

/// A citação da resposta: a original, ou só o id se ela foi excluída.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct ReplyRef {
    pub id: String,
    /// `None`: a original foi excluída ("Mensagem original excluída").
    pub author: Option<Author>,
    /// O começo do texto da original, até [`REPLY_EXCERPT`] caracteres.
    pub excerpt: Option<String>,
}

/// Quantos caracteres da original a citação leva.
pub const REPLY_EXCERPT: usize = 120;

/// Uma reação: o emoji e quem reagiu com ele.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct Reaction {
    /// O emoji Unicode, ou `c:<id>` de um emoji do grupo.
    pub emoji: String,
    /// Os ids de quem reagiu, na ordem em que reagiram.
    pub users: Vec<String>,
}

/// Quantos emojis diferentes uma mensagem pode ter.
pub const REACTIONS_MAX: i64 = 20;

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
    avatar_id: Option<String>,
    /// Os ids mencionados, separados por vírgula; `NULL` sem menção.
    mentions: Option<String>,
    kind: String,
    call_id: Option<String>,
    call_outcome: Option<String>,
    call_answered_at: Option<i64>,
    call_ended_at: Option<i64>,
    edited_at: Option<i64>,
    pinned_at: Option<i64>,
    reply_id: Option<String>,
    reply_body: Option<String>,
    reply_author_id: Option<String>,
    reply_nick: Option<String>,
    reply_display_name: Option<String>,
    reply_removed_at: Option<i64>,
    reply_avatar_id: Option<String>,
    forwarded: Option<String>,
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
                avatar: row.avatar_id,
            },
            body: row.body,
            mentions: split_mentions(row.mentions.as_deref()),
            created_at: row.created_at,
            kind: if row.kind == "call" {
                MessageKind::Call
            } else {
                MessageKind::Text
            },
            call: row.call_id.map(|id| CallRecord {
                id,
                outcome: row
                    .call_outcome
                    .as_deref()
                    .and_then(CallOutcome::parse)
                    .unwrap_or(CallOutcome::Missed),
                duration: match (row.call_answered_at, row.call_ended_at) {
                    (Some(start), Some(end)) => Some((end - start).max(0)),
                    _ => None,
                },
            }),
            edited_at: row.edited_at,
            reply_to: row.reply_id.map(|id| match row.reply_author_id {
                Some(author_id) => ReplyRef {
                    id,
                    author: Some(Author {
                        id: author_id,
                        nick: row.reply_nick.unwrap_or_default(),
                        display_name: row.reply_display_name,
                        removed: row.reply_removed_at.is_some(),
                        avatar: row.reply_avatar_id,
                    }),
                    excerpt: row.reply_body.map(|body| excerpt(&body)),
                },
                None => ReplyRef {
                    id,
                    author: None,
                    excerpt: None,
                },
            }),
            reactions: Vec::new(),
            pinned_at: row.pinned_at,
            attachments: Vec::new(),
            previews: Vec::new(),
            forwarded: row
                .forwarded
                .as_deref()
                .and_then(|json| serde_json::from_str(json).ok()),
        }
    }
}

/// O começo de `body` numa linha só, para a citação.
fn excerpt(body: &str) -> String {
    let line: String = body.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut out: String = line.chars().take(REPLY_EXCERPT).collect();
    if line.chars().count() > REPLY_EXCERPT {
        out.push('…');
    }
    out
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
                    u.id AS author_id, u.nick, u.display_name, u.removed_at, u.avatar_id,
                    (SELECT group_concat(x.user_id) FROM mentions x
                      WHERE x.message_id = m.id) AS mentions,
                    m.kind, m.call_id, k.outcome AS call_outcome,
                    k.answered_at AS call_answered_at, k.ended_at AS call_ended_at,
                    m.edited_at, m.pinned_at, m.reply_to AS reply_id, r.body AS reply_body,
                    ru.id AS reply_author_id, ru.nick AS reply_nick,
                    ru.display_name AS reply_display_name, ru.removed_at AS reply_removed_at,
                    ru.avatar_id AS reply_avatar_id, m.forwarded
             FROM messages m JOIN users u ON u.id = m.author_id
             LEFT JOIN calls k ON k.id = m.call_id
             LEFT JOIN messages r ON r.id = m.reply_to AND r.channel_id = m.channel_id
             LEFT JOIN users ru ON ru.id = r.author_id ",
            $rest
        )
    };
}

/// Confere o texto e devolve a versão sem espaços nas pontas.
///
/// Regras: de 1 a 2.000 caracteres depois do `trim`; quebras de linha valem,
/// mas no máximo 5 seguidas.
pub fn validate_body(input: &str) -> Result<String, ApiError> {
    validate_text(input, false)
}

/// Como [`validate_body`], mas o texto vazio vale se `has_files` (a mensagem só
/// com anexo, ADR 0032).
pub fn validate_text(input: &str, has_files: bool) -> Result<String, ApiError> {
    let body = input.trim();
    if body.is_empty() && has_files {
        return Ok(String::new());
    }
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
#[allow(clippy::too_many_arguments)]
pub async fn create(
    db: &SqlitePool,
    limiter: &SendLimiter,
    channel: &Readable,
    author: &User,
    client_id: &str,
    body: &str,
    reply: Option<ReplyTo<'_>>,
    attachments: &[String],
    now: i64,
) -> Result<(Message, bool), ApiError> {
    validate_client_id(client_id)?;
    let body = validate_text(body, !attachments.is_empty())?;
    let channel_id = channel.id();

    if let Some(existing) = find_existing(db, channel_id, author, client_id).await? {
        return Ok((existing, false));
    }
    check_attachments(db, author, attachments).await?;
    // Só se responde a uma mensagem que existe, no mesmo canal.
    let replied_author: Option<String> = match &reply {
        None => None,
        Some(reply) => Some(
            sqlx::query_scalar("SELECT author_id FROM messages WHERE id = ? AND channel_id = ?")
                .bind(reply.id)
                .bind(channel_id)
                .fetch_optional(db)
                .await?
                .ok_or_else(|| {
                    ApiError::NotFound("A mensagem respondida não existe mais.".into())
                })?,
        ),
    };
    limiter.try_send(&author.id)?;
    let mut mentioned = mentions::resolve(db, channel, author, &body).await?;
    // Com o `@` ligado, a resposta menciona quem escreveu a original.
    if let (Some(reply), Some(replied)) = (&reply, replied_author)
        && reply.mention
        && !mentioned.contains(&replied)
        && mentions::can_mention(db, channel, author, &replied).await?
    {
        mentioned.push(replied);
    }
    let reply_to = reply.map(|reply| reply.id);

    let id = Uuid::now_v7().to_string();
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    let inserted = sqlx::query(
        "INSERT INTO messages (id, channel_id, author_id, client_id, body, created_at, reply_to)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(channel_id)
    .bind(&author.id)
    .bind(client_id)
    .bind(&body)
    .bind(now)
    .bind(reply_to)
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
    for (position, file_id) in attachments.iter().enumerate() {
        sqlx::query("INSERT INTO message_files (message_id, file_id, position) VALUES (?, ?, ?)")
            .bind(&id)
            .bind(file_id)
            .bind(position as i64)
            .execute(&mut *tx)
            .await?;
    }
    files::mark_used(&mut tx, attachments, now).await?;
    read::advance(&mut tx, &author.id, channel_id, &id).await?;
    tx.commit().await?;
    Ok((get(db, &id).await?, true))
}

/// Encaminha `original` (de `from`, que quem encaminha lê) para `channel`, como mensagem nova de
/// `author`: o mesmo texto, os mesmos arquivos (sem copiar os bytes) e o resumo da original. Não
/// leva as reações, a resposta nem as menções (ninguém é notificado de novo). O mesmo `client_id`
/// devolve a que já existe, como no [`create`].
#[allow(clippy::too_many_arguments)]
pub async fn forward(
    db: &SqlitePool,
    limiter: &SendLimiter,
    channel: &Readable,
    author: &User,
    client_id: &str,
    original: &Message,
    from: &Readable,
    now: i64,
) -> Result<(Message, bool), ApiError> {
    validate_client_id(client_id)?;
    if original.kind != MessageKind::Text {
        return Err(ApiError::InvalidRequest(
            "Só dá para encaminhar uma mensagem de texto.".into(),
        ));
    }
    let channel_id = channel.id();
    if let Some(existing) = find_existing(db, channel_id, author, client_id).await? {
        return Ok((existing, false));
    }
    limiter.try_send(&author.id)?;
    let summary = ForwardedFrom {
        message_id: original.id.clone(),
        author_id: original.author.id.clone(),
        author_name: original
            .author
            .display_name
            .clone()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| original.author.nick.clone()),
        channel_name: match from {
            Readable::Text(text) => Some(text.name.clone()),
            Readable::Dm(_) => None,
        },
        created_at: original.created_at,
    };
    let summary = serde_json::to_string(&summary)
        .map_err(|error| ApiError::InvalidRequest(error.to_string()))?;

    let id = Uuid::now_v7().to_string();
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    let inserted = sqlx::query(
        "INSERT INTO messages (id, channel_id, author_id, client_id, body, created_at, forwarded)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(channel_id)
    .bind(&author.id)
    .bind(client_id)
    .bind(&original.body)
    .bind(now)
    .bind(&summary)
    .execute(&mut *tx)
    .await;
    match inserted {
        Ok(_) => {}
        Err(error) if unique_violation(&error).is_some() => {
            drop(tx);
            let existing = find_existing(db, channel_id, author, client_id).await?;
            return existing
                .map(|m| (m, false))
                .ok_or(ApiError::Internal(error));
        }
        Err(error) => return Err(error.into()),
    }
    sqlx::query(
        "INSERT INTO message_files (message_id, file_id, position)
         SELECT ?, file_id, position FROM message_files WHERE message_id = ?",
    )
    .bind(&id)
    .bind(&original.id)
    .execute(&mut *tx)
    .await?;
    read::advance(&mut tx, &author.id, channel_id, &id).await?;
    tx.commit().await?;
    Ok((get(db, &id).await?, true))
}

/// Os anexos de um envio: até [`ATTACHMENTS_MAX`], sem repetir, cada um um
/// arquivo `attachment` que a própria pessoa enviou e que nenhuma mensagem usa.
async fn check_attachments(
    db: &SqlitePool,
    author: &User,
    attachments: &[String],
) -> Result<(), ApiError> {
    if attachments.len() > ATTACHMENTS_MAX {
        return Err(ApiError::InvalidRequest(
            "Uma mensagem leva até 10 arquivos.".into(),
        ));
    }
    for (index, id) in attachments.iter().enumerate() {
        if attachments[..index].contains(id) {
            return Err(ApiError::InvalidRequest(
                "O mesmo arquivo foi anexado duas vezes.".into(),
            ));
        }
        let usable: bool = sqlx::query_scalar(
            "SELECT EXISTS (
                SELECT 1 FROM files f
                WHERE f.id = ? AND f.uploader_id = ? AND f.kind = 'attachment'
                  AND NOT EXISTS (SELECT 1 FROM message_files mf WHERE mf.file_id = f.id)
                  AND NOT EXISTS (SELECT 1 FROM files p WHERE p.thumbnail_id = f.id))",
        )
        .bind(id)
        .bind(&author.id)
        .fetch_one(db)
        .await?;
        if !usable {
            return Err(ApiError::InvalidRequest(
                "Um dos anexos não existe mais. Anexe de novo.".into(),
            ));
        }
    }
    Ok(())
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

pub(crate) async fn get(db: &SqlitePool, id: &str) -> Result<Message, ApiError> {
    let row: MessageRow = sqlx::query_as(select_message!("WHERE m.id = ?"))
        .bind(id)
        .fetch_one(db)
        .await?;
    let mut messages = vec![Message::from(row)];
    attach_extras(db, &mut messages).await?;
    Ok(messages.remove(0))
}

/// As mensagens `ids`, na mesma ordem (as que não existem mais ficam de fora).
pub async fn by_ids(db: &SqlitePool, ids: &[String]) -> Result<Vec<Message>, ApiError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut query = sqlx::QueryBuilder::new(select_message!("WHERE m.id IN ("));
    let mut list = query.separated(", ");
    for id in ids {
        list.push_bind(id);
    }
    query.push(")");
    let rows: Vec<MessageRow> = query.build_query_as().fetch_all(db).await?;
    let mut messages: Vec<Message> = rows.into_iter().map(Message::from).collect();
    attach_extras(db, &mut messages).await?;
    messages.sort_by_key(|m| ids.iter().position(|id| *id == m.id));
    Ok(messages)
}

/// A mensagem `id`, se ela existe.
pub async fn find(db: &SqlitePool, id: &str) -> Result<Option<Message>, ApiError> {
    let row: Option<MessageRow> = sqlx::query_as(select_message!("WHERE m.id = ?"))
        .bind(id)
        .fetch_optional(db)
        .await?;
    let Some(row) = row else { return Ok(None) };
    let mut messages = vec![Message::from(row)];
    attach_extras(db, &mut messages).await?;
    Ok(messages.pop())
}

/// Preenche as reações e os anexos de `messages`.
async fn attach_extras(db: &SqlitePool, messages: &mut [Message]) -> Result<(), ApiError> {
    attach_reactions(db, messages).await?;
    attach_files(db, messages).await?;
    let ids: Vec<&str> = messages.iter().map(|m| m.id.as_str()).collect();
    let found = previews::of_messages(db, &ids).await?;
    for (message_id, preview) in found {
        if let Some(message) = messages.iter_mut().find(|m| m.id == message_id) {
            message.previews.push(preview);
        }
    }
    Ok(())
}

/// Preenche os anexos de `messages` com uma consulta só.
async fn attach_files(db: &SqlitePool, messages: &mut [Message]) -> Result<(), ApiError> {
    if messages.is_empty() {
        return Ok(());
    }
    let mut query = sqlx::QueryBuilder::new(
        "SELECT mf.message_id, f.id, f.kind, f.name, f.mime, f.size, f.width, f.height,
                f.duration_ms, f.thumbnail_id
         FROM message_files mf JOIN files f ON f.id = mf.file_id
         WHERE mf.message_id IN (",
    );
    let mut ids = query.separated(", ");
    for message in messages.iter() {
        ids.push_bind(&message.id);
    }
    query.push(") ORDER BY mf.position");
    let rows: Vec<AttachmentRow> = query.build_query_as().fetch_all(db).await?;
    for row in rows {
        if let Some(message) = messages.iter_mut().find(|m| m.id == row.message_id) {
            message.attachments.push(row.file);
        }
    }
    Ok(())
}

#[derive(FromRow)]
struct AttachmentRow {
    message_id: String,
    #[sqlx(flatten)]
    file: FileView,
}

/// Preenche as reações de `messages` com uma consulta só.
async fn attach_reactions(db: &SqlitePool, messages: &mut [Message]) -> Result<(), ApiError> {
    if messages.is_empty() {
        return Ok(());
    }
    let mut query = sqlx::QueryBuilder::new(
        "SELECT message_id, emoji, user_id FROM reactions WHERE message_id IN (",
    );
    let mut ids = query.separated(", ");
    for message in messages.iter() {
        ids.push_bind(&message.id);
    }
    query.push(") ORDER BY created_at, rowid");
    let rows: Vec<(String, String, String)> = query.build_query_as().fetch_all(db).await?;
    for (message_id, emoji, user_id) in rows {
        let Some(message) = messages.iter_mut().find(|m| m.id == message_id) else {
            continue;
        };
        match message.reactions.iter_mut().find(|r| r.emoji == emoji) {
            Some(reaction) => reaction.users.push(user_id),
            None => message.reactions.push(Reaction {
                emoji,
                users: vec![user_id],
            }),
        }
    }
    Ok(())
}

/// Grava, dentro da transação `tx`, o registro da ligação `call_id` na conversa
/// `channel_id`, como mensagem de `caller_id` (quem ligou), e devolve o id dela.
/// O `client_id` é `call:<id>`: uma ligação tem um registro só.
///
/// O ponteiro de lido de quem ligou anda até ele, como em toda mensagem
/// própria. O de quem recebeu fica onde está: as não lidas só contam o
/// registro da chamada perdida ([`super::read`]).
pub(crate) async fn insert_call_record(
    tx: &mut sqlx::SqliteConnection,
    channel_id: &str,
    caller_id: &str,
    call_id: &str,
    now: i64,
) -> Result<String, ApiError> {
    let id = Uuid::now_v7().to_string();
    sqlx::query(
        "INSERT INTO messages (id, channel_id, author_id, client_id, body, created_at, kind, call_id)
         VALUES (?, ?, ?, ?, ?, ?, 'call', ?)",
    )
    .bind(&id)
    .bind(channel_id)
    .bind(caller_id)
    .bind(format!("call:{call_id}"))
    .bind(CALL_BODY)
    .bind(now)
    .bind(call_id)
    .execute(&mut *tx)
    .await?;
    read::advance(tx, caller_id, channel_id, &id).await?;
    Ok(id)
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
    let mut messages: Vec<Message> = row.map(Message::from).into_iter().collect();
    attach_extras(db, &mut messages).await?;
    Ok(messages.pop())
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
    /// Só no `around`: se há mensagens mais novas que a página.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub has_newer: Option<bool>,
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
    /// Metade antes e metade depois deste id, com ele junto (ir até uma mensagem
    /// antiga: a resposta, a busca, as fixadas).
    Around(String),
}

/// Até `limit` mensagens do canal `channel_id` no sentido de `cursor`.
pub async fn page(
    db: &SqlitePool,
    channel_id: &str,
    cursor: Cursor,
    limit: i64,
) -> Result<MessagePage, ApiError> {
    if let Cursor::Around(id) = &cursor {
        return around(db, channel_id, id, limit).await;
    }
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
        Cursor::Around(_) => unreachable!("tratado acima"),
    };
    let has_more = rows.len() as i64 > limit;
    rows.truncate(limit as usize);
    if !matches!(cursor, Cursor::After(_)) {
        rows.reverse();
    }
    let mut messages: Vec<Message> = rows.into_iter().map(Message::from).collect();
    attach_extras(db, &mut messages).await?;
    Ok(MessagePage {
        messages,
        has_more,
        has_newer: None,
    })
}

/// A página em volta de `id`: até `limit / 2` antes, a própria e o resto depois.
/// O `has_more` diz se há mais antigas; o `has_newer`, se há mais novas (o app
/// mostra "Ir para o presente").
async fn around(
    db: &SqlitePool,
    channel_id: &str,
    id: &str,
    limit: i64,
) -> Result<MessagePage, ApiError> {
    let exists: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM messages WHERE id = ? AND channel_id = ?")
            .bind(id)
            .bind(channel_id)
            .fetch_optional(db)
            .await?;
    if exists.is_none() {
        return Err(ApiError::NotFound("Essa mensagem não existe mais.".into()));
    }
    let before_count = limit / 2;
    let after_count = limit - before_count - 1;
    let mut before: Vec<MessageRow> = sqlx::query_as(select_message!(
        "WHERE m.channel_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?"
    ))
    .bind(channel_id)
    .bind(id)
    .bind(before_count + 1)
    .fetch_all(db)
    .await?;
    let mut after: Vec<MessageRow> = sqlx::query_as(select_message!(
        "WHERE m.channel_id = ? AND m.id >= ? ORDER BY m.id ASC LIMIT ?"
    ))
    .bind(channel_id)
    .bind(id)
    .bind(after_count + 2)
    .fetch_all(db)
    .await?;
    let has_more = before.len() as i64 > before_count;
    before.truncate(before_count as usize);
    before.reverse();
    let has_newer = after.len() as i64 > after_count + 1;
    after.truncate((after_count + 1) as usize);
    let mut messages: Vec<Message> = before.into_iter().chain(after).map(Message::from).collect();
    attach_extras(db, &mut messages).await?;
    Ok(MessagePage {
        messages,
        has_more,
        has_newer: Some(has_newer),
    })
}

/// O que mudou numa edição: a mensagem nova e quem passou a ser mencionado.
#[derive(Debug)]
pub struct Edited {
    pub message: Message,
    /// Quem a edição mencionou e não era mencionado antes: só esses são
    /// notificados (ADR 0032).
    pub new_mentions: Vec<String>,
}

/// Troca o texto da mensagem `message` por `body`. Só o autor, e só numa
/// mensagem de texto. O texto vazio só vale se a mensagem tem anexo.
pub async fn edit(
    db: &SqlitePool,
    channel: &Readable,
    author: &User,
    message: &Message,
    body: &str,
    now: i64,
) -> Result<Edited, ApiError> {
    if message.author.id != author.id || message.kind != MessageKind::Text {
        return Err(ApiError::Forbidden);
    }
    let body = validate_text(body, !message.attachments.is_empty())?;
    let mentioned = mentions::resolve(db, channel, author, &body).await?;
    let new_mentions: Vec<String> = mentioned
        .iter()
        .filter(|id| !message.mentions.contains(id))
        .cloned()
        .collect();
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    sqlx::query("UPDATE messages SET body = ?, edited_at = ? WHERE id = ?")
        .bind(&body)
        .bind(now)
        .bind(&message.id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM mentions WHERE message_id = ?")
        .bind(&message.id)
        .execute(&mut *tx)
        .await?;
    for user_id in &mentioned {
        sqlx::query("INSERT INTO mentions (message_id, user_id, channel_id) VALUES (?, ?, ?)")
            .bind(&message.id)
            .bind(user_id)
            .bind(channel.id())
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(Edited {
        message: get(db, &message.id).await?,
        new_mentions,
    })
}

/// Quantas mensagens fixadas um canal tem no máximo.
pub const PINS_MAX: i64 = 50;

/// Fixa (`on`) ou desafixa `message` de `channel` (decisão 24 do plano da v0.7): num canal, quem
/// tem "Gerenciar canais"; numa conversa privada, os dois. Até [`PINS_MAX`] por canal. Repetir
/// não muda nada. Devolve a mensagem como ficou.
pub async fn set_pinned(
    db: &SqlitePool,
    channel: &Readable,
    user: &User,
    message: &Message,
    on: bool,
    now: i64,
) -> Result<Message, ApiError> {
    if let Readable::Text(_) = channel {
        crate::identity::permissions::require_permission(
            db,
            user,
            crate::identity::permissions::Permission::ManageChannels,
        )
        .await?;
    }
    if message.kind != MessageKind::Text {
        return Err(ApiError::InvalidRequest(
            "Só dá para fixar uma mensagem de texto.".into(),
        ));
    }
    if on == message.pinned_at.is_some() {
        return Ok(message.clone());
    }
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    if on {
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM messages WHERE channel_id = ? AND pinned_at IS NOT NULL",
        )
        .bind(&message.channel_id)
        .fetch_one(&mut *tx)
        .await?;
        if count >= PINS_MAX {
            return Err(ApiError::Conflict(
                "Já são 50 mensagens fixadas aqui. Desafixe uma antes.".into(),
            ));
        }
    }
    sqlx::query("UPDATE messages SET pinned_at = ?, pinned_by = ? WHERE id = ?")
        .bind(on.then_some(now))
        .bind(on.then_some(&user.id))
        .bind(&message.id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    get(db, &message.id).await
}

/// As fixadas de `channel_id`, da fixada mais recente para a mais antiga.
pub async fn pins(db: &SqlitePool, channel_id: &str) -> Result<Vec<Message>, ApiError> {
    let rows: Vec<MessageRow> = sqlx::query_as(select_message!(
        "WHERE m.channel_id = ? AND m.pinned_at IS NOT NULL ORDER BY m.pinned_at DESC, m.id DESC"
    ))
    .bind(channel_id)
    .fetch_all(db)
    .await?;
    let mut messages: Vec<Message> = rows.into_iter().map(Message::from).collect();
    attach_extras(db, &mut messages).await?;
    Ok(messages)
}

/// Se `user` pode excluir `message` de `channel`: o autor, ou o dono numa
/// mensagem de canal. O registro de uma ligação ninguém exclui.
pub fn can_delete(channel: &Readable, user: &User, message: &Message) -> bool {
    if message.kind != MessageKind::Text {
        return false;
    }
    message.author.id == user.id || (user.is_owner && matches!(channel, Readable::Text(_)))
}

/// Exclui a mensagem `message_id` de verdade, com as menções, as reações e os
/// arquivos que só ela usava. As respostas a ela ficam, com a citação "Mensagem
/// original excluída". Devolve os ids dos arquivos que saíram, para quem chama
/// apagar os bytes.
pub async fn delete(db: &SqlitePool, message_id: &str) -> Result<Vec<String>, ApiError> {
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    let used: Vec<String> =
        sqlx::query_scalar("SELECT file_id FROM message_files WHERE message_id = ?")
            .bind(message_id)
            .fetch_all(&mut *tx)
            .await?;
    for sql in [
        "DELETE FROM mentions WHERE message_id = ?",
        "DELETE FROM reactions WHERE message_id = ?",
        "DELETE FROM message_files WHERE message_id = ?",
        "DELETE FROM message_previews WHERE message_id = ?",
        "DELETE FROM messages WHERE id = ?",
    ] {
        sqlx::query(sql).bind(message_id).execute(&mut *tx).await?;
    }
    let released = files::release(&mut tx, &used).await?;
    tx.commit().await?;
    Ok(released)
}

/// Confere um emoji de reação: um emoji Unicode (sem letras nem números ASCII, até
/// 16 caracteres, por causa das bandeiras e dos tons de pele) ou `c:<id>` de um
/// emoji do grupo.
pub fn validate_emoji(input: &str) -> Result<(), ApiError> {
    let ok = if let Some(id) = input.strip_prefix("c:") {
        (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    } else {
        let count = input.chars().count();
        (1..=16).contains(&count)
            && !input
                .chars()
                .any(|c| c.is_ascii() && !c.is_ascii_digit() && c != '#' && c != '*')
            && !input.is_ascii()
    };
    if ok {
        Ok(())
    } else {
        Err(ApiError::InvalidRequest("Esse emoji não é válido.".into()))
    }
}

/// Põe (ou tira, com `on = false`) a reação `emoji` de `user` em `message`. Até
/// [`REACTIONS_MAX`] emojis diferentes por mensagem; repetir não faz nada.
pub async fn react(
    db: &SqlitePool,
    user: &User,
    message: &Message,
    emoji: &str,
    on: bool,
    now: i64,
) -> Result<Message, ApiError> {
    validate_emoji(emoji)?;
    if on {
        let known = message.reactions.iter().any(|r| r.emoji == emoji);
        if !known && message.reactions.len() as i64 >= REACTIONS_MAX {
            return Err(ApiError::Conflict(
                "Essa mensagem já tem 20 reações diferentes.".into(),
            ));
        }
        sqlx::query(
            "INSERT OR IGNORE INTO reactions (message_id, user_id, emoji, created_at)
             VALUES (?, ?, ?, ?)",
        )
        .bind(&message.id)
        .bind(&user.id)
        .bind(emoji)
        .bind(now)
        .execute(db)
        .await?;
    } else {
        sqlx::query("DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?")
            .bind(&message.id)
            .bind(&user.id)
            .bind(emoji)
            .execute(db)
            .await?;
    }
    get(db, &message.id).await
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
