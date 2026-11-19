//! Lidas e silenciar (ADR 0022): até onde cada pessoa leu cada canal ou
//! conversa, quantas mensagens e menções estão depois disso, e se ela silenciou.
//!
//! O ponteiro é o id da última mensagem lida, e só anda para a frente. Ele é
//! da pessoa, e não do computador: ler num lugar zera o número no outro.
//!
//! Nada aqui confere se a pessoa pode ler o canal: as rotas passam antes pela
//! regra de leitura ([`super::access::readable`]).

use serde::Serialize;
use sqlx::{FromRow, SqliteConnection, SqlitePool};
use ts_rs::TS;

use crate::error::ApiError;

/// Onde as duas contagens param. O app mostra "99+".
pub const UNREAD_CAP: i64 = 100;

/// O estado de um canal ou conversa para uma pessoa.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct ReadState {
    /// A última mensagem lida. `None`: não leu nada.
    pub last_read_id: Option<String>,
    /// Mensagens dos outros depois do ponteiro, até [`UNREAD_CAP`]. Do registro
    /// de ligação, só a chamada perdida conta.
    pub unread: i64,
    /// Menções à pessoa depois do ponteiro, até [`UNREAD_CAP`]. Conta mesmo
    /// com o canal silenciado.
    pub mentions: i64,
    pub muted: bool,
}

/// Um canal de texto ou conversa como o `ready` do tempo real leva: a mensagem
/// mais nova e o estado de quem conectou. Na volta de uma queda, o app compara
/// o `last_message_id` com a última que tem e só chama o `?after=` dos que
/// andaram.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct ChannelHead {
    pub channel_id: String,
    /// `None` no canal que ainda não tem mensagem.
    pub last_message_id: Option<String>,
    pub state: ReadState,
}

#[derive(FromRow)]
struct HeadRow {
    channel_id: String,
    last_message_id: Option<String>,
    last_read_id: Option<String>,
    unread: i64,
    mentions: i64,
    muted: bool,
}

impl From<HeadRow> for ChannelHead {
    fn from(row: HeadRow) -> Self {
        Self {
            channel_id: row.channel_id,
            last_message_id: row.last_message_id,
            state: ReadState {
                last_read_id: row.last_read_id,
                unread: row.unread,
                mentions: row.mentions,
                muted: row.muted,
            },
        }
    }
}

/// O `SELECT` de [`HeadRow`] para a pessoa `?1`, seguido do resto da consulta.
/// O `100` é o [`UNREAD_CAP`]. As minhas mensagens não contam como não lidas,
/// e dos registros de ligação (ADR 0023) só conta o da chamada perdida.
macro_rules! select_head {
    ($rest:literal) => {
        concat!(
            "SELECT c.id AS channel_id,
                    (SELECT MAX(m.id) FROM messages m WHERE m.channel_id = c.id) AS last_message_id,
                    s.last_read_id,
                    (SELECT MIN(COUNT(*), 100) FROM messages m
                      WHERE m.channel_id = c.id AND m.author_id <> ?1
                        AND m.id > COALESCE(s.last_read_id, '')
                        AND (m.kind = 'text'
                             OR EXISTS (SELECT 1 FROM calls k
                                        WHERE k.id = m.call_id AND k.outcome = 'missed'))) AS unread,
                    (SELECT MIN(COUNT(*), 100) FROM mentions x
                      WHERE x.channel_id = c.id AND x.user_id = ?1
                        AND x.message_id > COALESCE(s.last_read_id, '')) AS mentions,
                    COALESCE(s.muted, 0) AS muted
             FROM channels c
             LEFT JOIN channel_state s ON s.channel_id = c.id AND s.user_id = ?1 ",
            $rest
        )
    };
}

/// Os canais de texto abertos, em ordem de id, com o estado de `user_id`.
pub async fn heads(db: &SqlitePool, user_id: &str) -> Result<Vec<ChannelHead>, ApiError> {
    let rows: Vec<HeadRow> = sqlx::query_as(select_head!(
        "WHERE c.kind = 'text' AND c.archived_at IS NULL ORDER BY c.id"
    ))
    .bind(user_id)
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(ChannelHead::from).collect())
}

/// O mesmo para as conversas privadas de `user_id` que já têm mensagem. A
/// vazia não entra: ela só existe para a pessoa depois da primeira mensagem.
pub async fn dm_heads(db: &SqlitePool, user_id: &str) -> Result<Vec<ChannelHead>, ApiError> {
    let rows: Vec<HeadRow> = sqlx::query_as(select_head!(
        "JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = ?1
         WHERE c.kind = 'dm' AND EXISTS (SELECT 1 FROM messages WHERE channel_id = c.id)
         ORDER BY c.id"
    ))
    .bind(user_id)
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(ChannelHead::from).collect())
}

/// O estado de `user_id` no canal ou conversa `channel_id`.
pub async fn state(
    db: &SqlitePool,
    user_id: &str,
    channel_id: &str,
) -> Result<ReadState, ApiError> {
    let row: HeadRow = sqlx::query_as(select_head!("WHERE c.id = ?2"))
        .bind(user_id)
        .bind(channel_id)
        .fetch_one(db)
        .await?;
    Ok(ChannelHead::from(row).state)
}

/// Leva o ponteiro de `user_id` até `message_id`. O ponteiro nunca volta:
/// marcar uma mensagem mais velha que a já lida não muda nada. `true` se andou.
///
/// A mensagem tem de ser desse canal: `InvalidRequest` se não for.
pub async fn mark_read(
    db: &SqlitePool,
    user_id: &str,
    channel_id: &str,
    message_id: &str,
) -> Result<bool, ApiError> {
    let exists: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM messages WHERE id = ? AND channel_id = ?")
            .bind(message_id)
            .bind(channel_id)
            .fetch_optional(db)
            .await?;
    if exists.is_none() {
        return Err(ApiError::InvalidRequest(
            "Essa mensagem não é deste canal.".into(),
        ));
    }
    let mut conn = db.acquire().await?;
    advance(&mut conn, user_id, channel_id, message_id).await
}

/// O `UPDATE` do ponteiro, sem conferir a mensagem. Também é o que o envio usa
/// para quem escreveu: escrever no canal é ter lido até ali.
pub(super) async fn advance(
    conn: &mut SqliteConnection,
    user_id: &str,
    channel_id: &str,
    message_id: &str,
) -> Result<bool, ApiError> {
    let done = sqlx::query(
        "INSERT INTO channel_state (user_id, channel_id, last_read_id) VALUES (?, ?, ?)
         ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_id = excluded.last_read_id
         WHERE channel_state.last_read_id IS NULL
            OR excluded.last_read_id > channel_state.last_read_id",
    )
    .bind(user_id)
    .bind(channel_id)
    .bind(message_id)
    .execute(conn)
    .await?;
    Ok(done.rows_affected() > 0)
}

/// Leva o ponteiro de `user_id` até o fim de todo canal de texto aberto e de
/// toda conversa dele. Devolve os canais em que o ponteiro andou.
pub async fn mark_all_read(db: &SqlitePool, user_id: &str) -> Result<Vec<String>, ApiError> {
    Ok(sqlx::query_scalar(
        "INSERT INTO channel_state (user_id, channel_id, last_read_id)
         SELECT ?1, c.id, (SELECT MAX(m.id) FROM messages m WHERE m.channel_id = c.id)
         FROM channels c
         WHERE ((c.kind = 'text' AND c.archived_at IS NULL)
             OR (c.kind = 'dm' AND EXISTS (SELECT 1 FROM channel_members cm
                                           WHERE cm.channel_id = c.id AND cm.user_id = ?1)))
           AND EXISTS (SELECT 1 FROM messages m WHERE m.channel_id = c.id)
         ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_id = excluded.last_read_id
         WHERE channel_state.last_read_id IS NULL
            OR excluded.last_read_id > channel_state.last_read_id
         RETURNING channel_id",
    )
    .bind(user_id)
    .fetch_all(db)
    .await?)
}

/// Silencia ou volta a ouvir o canal `channel_id` para `user_id`.
pub async fn set_muted(
    db: &SqlitePool,
    user_id: &str,
    channel_id: &str,
    muted: bool,
) -> Result<(), ApiError> {
    sqlx::query(
        "INSERT INTO channel_state (user_id, channel_id, muted) VALUES (?, ?, ?)
         ON CONFLICT (user_id, channel_id) DO UPDATE SET muted = excluded.muted",
    )
    .bind(user_id)
    .bind(channel_id)
    .bind(muted)
    .execute(db)
    .await?;
    Ok(())
}

/// Quem acabou de entrar no grupo começa com todo canal de texto lido até a
/// última mensagem, como a migração `0005` fez com quem já estava: vê o
/// histórico, sem números. Roda na transação que cria o membro.
pub async fn seed_new_member(conn: &mut SqliteConnection, user_id: &str) -> Result<(), ApiError> {
    sqlx::query(
        "INSERT INTO channel_state (user_id, channel_id, last_read_id)
         SELECT ?, c.id, (SELECT MAX(m.id) FROM messages m WHERE m.channel_id = c.id)
         FROM channels c WHERE c.kind = 'text'",
    )
    .bind(user_id)
    .execute(conn)
    .await?;
    Ok(())
}
