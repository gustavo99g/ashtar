//! Ligações privadas (ADR 0023): a ligação entre as duas pessoas de uma
//! conversa privada, do toque ao registro no histórico.
//!
//! A API só sinaliza: guarda cada ligação na tabela `calls` e diz em que pé ela
//! está. A voz é a de sempre, no LiveKit, numa sala com o nome da conversa; o
//! token dela só sai com a ligação atendida (`routes/voice.rs`).
//!
//! Uma conversa tem no máximo uma ligação sem fim (o índice
//! `calls_open_by_channel`). Toda ligação que acaba deixa um registro, uma
//! mensagem `kind = 'call'` de quem ligou, gravado na mesma transação.
//!
//! Quem avisa os dois pelo tempo real são as rotas (`routes/calls.rs`) e o
//! webhook: aqui ficam só as regras e o banco.

use std::time::Duration;

use serde::Serialize;
use sqlx::{FromRow, SqliteConnection, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use crate::chat::dms::Dm;
use crate::chat::messages::{self, Author, Message};
use crate::error::ApiError;
use crate::identity::{User, users};

/// Quanto a ligação toca sem resposta antes de virar chamada perdida.
pub const RING_TIMEOUT: Duration = Duration::from_secs(30);

/// Em que pé a ligação está, ou como acabou.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
pub enum CallOutcome {
    /// Tocando: ninguém atendeu ainda.
    Ringing,
    /// Atendida. Sem `ended_at`, os dois estão conversando.
    Answered,
    /// Tocou até o fim do tempo sem ninguém atender.
    Missed,
    /// Quem recebeu recusou.
    Declined,
    /// Quem ligou desistiu antes de atenderem.
    Cancelled,
}

impl CallOutcome {
    fn as_str(self) -> &'static str {
        match self {
            Self::Ringing => "ringing",
            Self::Answered => "answered",
            Self::Missed => "missed",
            Self::Declined => "declined",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        Some(match text {
            "ringing" => Self::Ringing,
            "answered" => Self::Answered,
            "missed" => Self::Missed,
            "declined" => Self::Declined,
            "cancelled" => Self::Cancelled,
            _ => return None,
        })
    }
}

/// O que o registro no histórico leva da ligação (o `call` da [`Message`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct CallRecord {
    pub id: String,
    pub outcome: CallOutcome,
    /// Em segundos, do atender ao desligar. Só na ligação atendida.
    pub duration: Option<i64>,
}

/// Uma ligação como o banco guarda.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Call {
    pub id: String,
    pub channel_id: String,
    pub caller_id: String,
    pub created_at: i64,
    pub answered_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub outcome: CallOutcome,
}

impl Call {
    /// Em segundos, do atender ao fim; `None` se não foi atendida ou não acabou.
    pub fn duration(&self) -> Option<i64> {
        Some((self.ended_at? - self.answered_at?).max(0))
    }

    pub fn is_ringing(&self) -> bool {
        self.outcome == CallOutcome::Ringing
    }
}

#[derive(FromRow)]
struct CallRow {
    id: String,
    channel_id: String,
    caller_id: String,
    created_at: i64,
    answered_at: Option<i64>,
    ended_at: Option<i64>,
    outcome: String,
}

impl TryFrom<CallRow> for Call {
    type Error = ApiError;

    fn try_from(row: CallRow) -> Result<Self, ApiError> {
        let outcome = CallOutcome::parse(&row.outcome)
            .ok_or_else(|| ApiError::Config(format!("outcome desconhecido: {}", row.outcome)))?;
        Ok(Self {
            id: row.id,
            channel_id: row.channel_id,
            caller_id: row.caller_id,
            created_at: row.created_at,
            answered_at: row.answered_at,
            ended_at: row.ended_at,
            outcome,
        })
    }
}

/// O `SELECT` de [`CallRow`], seguido do resto da consulta.
macro_rules! select_call {
    ($rest:literal) => {
        concat!(
            "SELECT id, channel_id, caller_id, created_at, answered_at, ended_at, outcome
             FROM calls ",
            $rest
        )
    };
}

/// Uma ligação em andamento como o tempo real leva: quem liga, quem recebe e em
/// que pé está (`ringing` ou `answered`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct CallView {
    pub id: String,
    /// A conversa: é também o nome da sala no LiveKit.
    pub channel_id: String,
    pub caller: Author,
    pub callee: Author,
    pub outcome: CallOutcome,
    pub created_at: i64,
    pub answered_at: Option<i64>,
}

/// Uma ligação que acabou: como ficou, as duas pessoas e o registro novo no
/// histórico.
#[derive(Debug, Clone)]
pub struct Ended {
    pub call: Call,
    pub members: [String; 2],
    pub message: Message,
}

/// O que o "Ligar" fez.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Started {
    /// Começou a tocar para a outra pessoa.
    Ringing(Call),
    /// A outra pessoa já estava chamando: valeu como atender (decisão 22).
    Answered(Call),
    /// Quem pede já estava chamando: a mesma ligação, sem outra.
    Already(Call),
}

fn author(user: &User) -> Author {
    Author::of(user)
}

/// A ligação como o tempo real leva, com quem liga e quem recebe.
pub async fn view(db: &SqlitePool, dm: &Dm, call: &Call) -> Result<CallView, ApiError> {
    let caller = users::get_by_id(db, &call.caller_id).await?;
    let callee = users::get_by_id(db, dm.other(&call.caller_id)).await?;
    Ok(CallView {
        id: call.id.clone(),
        channel_id: call.channel_id.clone(),
        caller: author(&caller),
        callee: author(&callee),
        outcome: call.outcome,
        created_at: call.created_at,
        answered_at: call.answered_at,
    })
}

/// A ligação sem fim da conversa `channel_id`, se há uma.
async fn open_in(conn: &mut SqliteConnection, channel_id: &str) -> Result<Option<Call>, ApiError> {
    let row: Option<CallRow> =
        sqlx::query_as(select_call!("WHERE channel_id = ? AND ended_at IS NULL"))
            .bind(channel_id)
            .fetch_optional(&mut *conn)
            .await?;
    row.map(Call::try_from).transpose()
}

/// A ligação sem fim de `user_id` em qualquer conversa dele, se há uma. É a que
/// o `ready` leva para quem reconecta no meio.
pub async fn current_for(db: &SqlitePool, user_id: &str) -> Result<Option<Call>, ApiError> {
    let row: Option<CallRow> = sqlx::query_as(select_call!(
        "WHERE ended_at IS NULL AND channel_id IN
           (SELECT channel_id FROM channel_members WHERE user_id = ?)
         ORDER BY created_at DESC LIMIT 1"
    ))
    .bind(user_id)
    .fetch_optional(db)
    .await?;
    row.map(Call::try_from).transpose()
}

/// Se a conversa `channel_id` tem uma ligação atendida e em andamento: é o que
/// libera o token da sala dela.
pub async fn is_answered(db: &SqlitePool, channel_id: &str) -> Result<bool, ApiError> {
    let mut conn = db.acquire().await?;
    Ok(open_in(&mut conn, channel_id)
        .await?
        .is_some_and(|call| call.outcome == CallOutcome::Answered))
}

pub async fn get(db: &SqlitePool, id: &str) -> Result<Call, ApiError> {
    let row: CallRow = sqlx::query_as(select_call!("WHERE id = ?"))
        .bind(id)
        .fetch_one(db)
        .await?;
    row.try_into()
}

async fn answer(conn: &mut SqliteConnection, call: &Call, now: i64) -> Result<Call, ApiError> {
    sqlx::query("UPDATE calls SET outcome = 'answered', answered_at = ? WHERE id = ?")
        .bind(now)
        .bind(&call.id)
        .execute(&mut *conn)
        .await?;
    Ok(Call {
        outcome: CallOutcome::Answered,
        answered_at: Some(now),
        ..call.clone()
    })
}

/// Se `user_id` está em outra ligação sem fim, fora da conversa `channel_id`.
async fn busy_elsewhere(
    conn: &mut SqliteConnection,
    user_id: &str,
    channel_id: &str,
) -> Result<bool, ApiError> {
    let found: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM calls k JOIN channel_members cm ON cm.channel_id = k.channel_id
         WHERE cm.user_id = ? AND k.ended_at IS NULL AND k.channel_id <> ?",
    )
    .bind(user_id)
    .bind(channel_id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(found.is_some())
}

fn already_in_call() -> ApiError {
    ApiError::Conflict("Você já está numa ligação. Desligue antes de ligar de novo.".into())
}

/// `caller` liga para a outra pessoa da conversa `dm`.
///
/// Se a outra pessoa já está chamando, vale como atender; se quem pede já está
/// chamando, é a mesma ligação. Com a ligação já atendida, ou com quem pede em
/// outra ligação, `Conflict`. Quem confere se a outra pessoa está online é a
/// rota: aqui não há tempo real.
pub async fn start(db: &SqlitePool, dm: &Dm, caller: &User, now: i64) -> Result<Started, ApiError> {
    // Na transação de escrita: os dois apertando "Ligar" ao mesmo tempo, um
    // deles cria e o outro acha a ligação do primeiro.
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    if busy_elsewhere(&mut tx, &caller.id, &dm.id).await? {
        return Err(already_in_call());
    }
    let started = match open_in(&mut tx, &dm.id).await? {
        Some(call) if call.is_ringing() && call.caller_id == caller.id => Started::Already(call),
        Some(call) if call.is_ringing() => Started::Answered(answer(&mut tx, &call, now).await?),
        Some(_) => return Err(ApiError::Conflict("Vocês já estão numa ligação.".into())),
        None => {
            let call = Call {
                id: Uuid::now_v7().to_string(),
                channel_id: dm.id.clone(),
                caller_id: caller.id.clone(),
                created_at: now,
                answered_at: None,
                ended_at: None,
                outcome: CallOutcome::Ringing,
            };
            sqlx::query(
                "INSERT INTO calls (id, channel_id, caller_id, created_at) VALUES (?, ?, ?, ?)",
            )
            .bind(&call.id)
            .bind(&call.channel_id)
            .bind(&call.caller_id)
            .bind(now)
            .execute(&mut *tx)
            .await?;
            Started::Ringing(call)
        }
    };
    tx.commit().await?;
    Ok(started)
}

fn nothing_ringing() -> ApiError {
    ApiError::Conflict("Não há ligação tocando para você nesta conversa.".into())
}

/// `user` atende a ligação que está tocando para ele na conversa `dm`.
pub async fn accept(db: &SqlitePool, dm: &Dm, user: &User, now: i64) -> Result<Call, ApiError> {
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    let call = match open_in(&mut tx, &dm.id).await? {
        Some(call) if call.is_ringing() && call.caller_id != user.id => call,
        _ => return Err(nothing_ringing()),
    };
    if busy_elsewhere(&mut tx, &user.id, &dm.id).await? {
        return Err(already_in_call());
    }
    let call = answer(&mut tx, &call, now).await?;
    tx.commit().await?;
    Ok(call)
}

/// Fecha `call` com `outcome`, grava o registro no histórico e devolve os dois.
/// Tudo numa transação: uma ligação nunca acaba sem registro.
async fn close(
    db: &SqlitePool,
    mut tx: sqlx::Transaction<'_, sqlx::Sqlite>,
    dm: &Dm,
    call: Call,
    outcome: CallOutcome,
    now: i64,
) -> Result<Ended, ApiError> {
    sqlx::query("UPDATE calls SET outcome = ?, ended_at = ? WHERE id = ? AND ended_at IS NULL")
        .bind(outcome.as_str())
        .bind(now)
        .bind(&call.id)
        .execute(&mut *tx)
        .await?;
    let message_id =
        messages::insert_call_record(&mut tx, &call.channel_id, &call.caller_id, &call.id, now)
            .await?;
    tx.commit().await?;
    Ok(Ended {
        call: Call {
            outcome,
            ended_at: Some(now),
            ..call
        },
        members: dm.members.clone(),
        message: messages::get(db, &message_id).await?,
    })
}

/// O que encerrar quer dizer, de quem pede.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Hangup {
    /// Recusar a ligação que está tocando para você.
    Decline,
    /// Desistir da ligação que você fez, antes de atenderem.
    Cancel,
    /// Desligar: na atendida, encerra; tocando, é recusar ou desistir,
    /// conforme quem pede.
    End,
}

/// `user` encerra a ligação da conversa `dm` do jeito de `how`. Sem ligação que
/// combine (nada tocando para recusar, por exemplo), `Conflict`.
pub async fn hang_up(
    db: &SqlitePool,
    dm: &Dm,
    user: &User,
    how: Hangup,
    now: i64,
) -> Result<Ended, ApiError> {
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    let call = open_in(&mut tx, &dm.id).await?;
    let mine = call.as_ref().is_some_and(|call| call.caller_id == user.id);
    let outcome = match (&call, how) {
        (Some(call), Hangup::Decline) if call.is_ringing() && !mine => CallOutcome::Declined,
        (Some(call), Hangup::Cancel) if call.is_ringing() && mine => CallOutcome::Cancelled,
        (Some(call), Hangup::End) if call.is_ringing() && mine => CallOutcome::Cancelled,
        (Some(call), Hangup::End) if call.is_ringing() => CallOutcome::Declined,
        (Some(_), Hangup::End) => CallOutcome::Answered,
        (_, Hangup::Decline) => return Err(nothing_ringing()),
        _ => {
            return Err(ApiError::Conflict(
                "Não há ligação sua para encerrar nesta conversa.".into(),
            ));
        }
    };
    let call = call.expect("os casos sem ligação já voltaram");
    close(db, tx, dm, call, outcome, now).await
}

/// O tempo limite: se a ligação `call_id` ainda está tocando, vira chamada
/// perdida. `None` se alguém já atendeu, recusou ou desistiu.
pub async fn expire(
    db: &SqlitePool,
    dm: &Dm,
    call_id: &str,
    now: i64,
) -> Result<Option<Ended>, ApiError> {
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    match open_in(&mut tx, &dm.id).await? {
        Some(call) if call.id == call_id && call.is_ringing() => Ok(Some(
            close(db, tx, dm, call, CallOutcome::Missed, now).await?,
        )),
        _ => Ok(None),
    }
}

/// O fim pelo LiveKit: um dos dois saiu da sala, ou ela fechou. Encerra a
/// ligação atendida da conversa `dm`, se há uma. Tocando, não muda nada: ainda
/// ninguém entrou na sala.
pub async fn end_by_room(db: &SqlitePool, dm: &Dm, now: i64) -> Result<Option<Ended>, ApiError> {
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    match open_in(&mut tx, &dm.id).await? {
        Some(call) if call.outcome == CallOutcome::Answered => Ok(Some(
            close(db, tx, dm, call, CallOutcome::Answered, now).await?,
        )),
        _ => Ok(None),
    }
}

/// Ao subir a API: toda ligação que ficou sem fim de antes acaba agora, com o
/// registro. A que tocava vira perdida; a atendida, encerrada. Devolve quantas.
pub async fn close_stale(db: &SqlitePool, now: i64) -> Result<usize, ApiError> {
    let rows: Vec<CallRow> = sqlx::query_as(select_call!("WHERE ended_at IS NULL"))
        .fetch_all(db)
        .await?;
    let mut closed = 0;
    for row in rows {
        let call = Call::try_from(row)?;
        let Some(dm) = crate::chat::dms::get(db, &call.channel_id).await? else {
            continue;
        };
        let outcome = if call.is_ringing() {
            CallOutcome::Missed
        } else {
            CallOutcome::Answered
        };
        let tx = db.begin_with("BEGIN IMMEDIATE").await?;
        close(db, tx, &dm, call, outcome, now).await?;
        closed += 1;
    }
    Ok(closed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn o_resultado_vai_e_volta_como_texto() {
        for outcome in [
            CallOutcome::Ringing,
            CallOutcome::Answered,
            CallOutcome::Missed,
            CallOutcome::Declined,
            CallOutcome::Cancelled,
        ] {
            assert_eq!(CallOutcome::parse(outcome.as_str()), Some(outcome));
            assert_eq!(
                serde_json::to_value(outcome).unwrap(),
                serde_json::Value::from(outcome.as_str())
            );
        }
        assert_eq!(CallOutcome::parse("busy"), None);
    }

    #[test]
    fn a_duracao_e_do_atender_ao_fim() {
        let call = Call {
            id: "c".into(),
            channel_id: "d".into(),
            caller_id: "a".into(),
            created_at: 100,
            answered_at: Some(110),
            ended_at: Some(170),
            outcome: CallOutcome::Answered,
        };
        assert_eq!(call.duration(), Some(60));
        let missed = Call {
            answered_at: None,
            outcome: CallOutcome::Missed,
            ..call.clone()
        };
        assert_eq!(missed.duration(), None);
        let going = Call {
            ended_at: None,
            ..call
        };
        assert_eq!(going.duration(), None);
    }
}
