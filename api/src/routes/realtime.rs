//! O WebSocket do app: o ticket (`POST /api/realtime/ticket`) e a conexão
//! (`GET /api/realtime?ticket=`).
//!
//! O WebSocket do navegador não manda cabeçalho, então o `Authorization` e o
//! `X-App-Version` não chegam na conexão. O app pede o ticket pela rota comum,
//! que passa pela `ClientPolicy` e pela sessão, e conecta com ele em até 30
//! segundos. O ticket vale uma vez.
//!
//! Todo evento do hub passa por todas as conexões, e cada uma só escreve no
//! socket o que é da pessoa dela (o `to` do [`Signal::Event`]).

use std::sync::Arc;
use std::time::Duration;

use axum::Json;
use axum::extract::rejection::QueryRejection;
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::Response;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tokio::sync::broadcast::error::RecvError;
use tokio::time::{Instant, sleep_until};
use ts_rs::TS;

use super::auth::CurrentUser;
use crate::AppState;
use crate::calls::{self, CallView};
use crate::chat::access::{self, Readable};
use crate::chat::dms;
use crate::chat::read::{self, ChannelHead};
use crate::error::ApiError;
use crate::identity::status::{self, Shown, Status};
use crate::identity::users;
use crate::realtime::{Audience, Hub, ServerEvent, Signal, TICKET_TTL};

/// Sem nada do app por este tempo (nem o `ping` de 25 em 25 segundos), a API
/// fecha a conexão.
const IDLE_TIMEOUT: Duration = Duration::from_secs(60);

/// Erro do servidor ao montar o `ready` (RFC 6455).
const CLOSE_INTERNAL: u16 = 1011;

/// Códigos de fechamento próprios (de 4000 a 4999, livres pela RFC 6455).
pub const CLOSE_LAGGED: u16 = 4000;
pub const CLOSE_SESSION_ENDED: u16 = 4001;

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct RealtimeTicket {
    pub ticket: String,
    /// Em segundos.
    pub expires_in: u64,
}

/// `POST /api/realtime/ticket`.
pub async fn ticket(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Json<RealtimeTicket> {
    Json(RealtimeTicket {
        ticket: state.hub.issue_ticket(&user.id),
        expires_in: TICKET_TTL.as_secs(),
    })
}

#[derive(Debug, Deserialize)]
pub struct ConnectQuery {
    #[serde(default)]
    pub ticket: String,
}

/// `GET /api/realtime?ticket=`: fora da `ClientPolicy`. Ticket inválido,
/// usado, vencido, ou de quem já foi removido: 401 antes do upgrade.
pub async fn connect(
    State(state): State<AppState>,
    query: Result<Query<ConnectQuery>, QueryRejection>,
    upgrade: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    let ticket = query.map(|Query(q)| q.ticket).unwrap_or_default();
    let user_id = state
        .hub
        .redeem_ticket(&ticket)
        .ok_or(ApiError::Unauthenticated)?;
    let user = users::find_by_id(&state.db, &user_id)
        .await?
        .filter(|user| user.is_active())
        .ok_or(ApiError::Unauthenticated)?;
    let hub = Arc::clone(&state.hub);
    let db = state.db.clone();
    Ok(upgrade.on_upgrade(move |socket| run(hub, db, user.id, socket)))
}

/// A vida de uma conexão: o `ready`, depois os eventos do hub e os `ping` do
/// app, até alguém fechar.
async fn run(hub: Arc<Hub>, db: SqlitePool, user_id: String, mut socket: WebSocket) {
    // Conta a conexão antes de assinar, para ela não receber o próprio
    // "online". O `online` e os canais do `ready` são lidos com a assinatura
    // feita: uma mensagem que chegar no meio vem pelo `ready` ou pelo evento
    // (ou pelos dois, e o app ignora o id repetido), nunca por nenhum.
    let status = match status::get(&db, &user_id).await {
        Ok(status) => status,
        Err(error) => {
            eprintln!("realtime: não deu para ler o status: {error}");
            close(&mut socket, CLOSE_INTERNAL, "Erro no servidor: reconecte.").await;
            return;
        }
    };
    hub.connect(&user_id, status);
    let mut idle = false;
    let mut events = hub.subscribe();
    match heads(&db, &user_id).await {
        Ok((channels, dms, call)) => {
            let online = hub.online();
            let with = |wanted: Shown| -> Vec<String> {
                online
                    .iter()
                    .filter(|(_, shown)| *shown == wanted)
                    .map(|(id, _)| id.clone())
                    .collect()
            };
            let ready = ServerEvent::Ready {
                user_id: user_id.clone(),
                status,
                busy: with(Shown::Busy),
                away: with(Shown::Away),
                online: online.into_iter().map(|(id, _)| id).collect(),
                channels,
                dms,
                call,
            };
            if send(&mut socket, &ready).await {
                let mut connection = Connection {
                    hub: &hub,
                    db: &db,
                    user_id: &user_id,
                    idle: false,
                    last_typing: None,
                };
                serve(&mut connection, &mut socket, &mut events).await;
                idle = connection.idle;
            }
        }
        Err(error) => {
            eprintln!("realtime: não deu para montar o ready: {error}");
            close(&mut socket, CLOSE_INTERNAL, "Erro no servidor: reconecte.").await;
        }
    }
    hub.disconnect(&user_id, idle);
}

/// O que o `ready` leva do chat: os canais de texto, que são de todos, e as
/// conversas privadas de `user_id`, cada um com o estado de leitura dele, e a
/// ligação em que a pessoa está, se está numa.
async fn heads(
    db: &SqlitePool,
    user_id: &str,
) -> Result<(Vec<ChannelHead>, Vec<ChannelHead>, Option<CallView>), ApiError> {
    let call = match calls::current_for(db, user_id).await? {
        Some(call) => match dms::get(db, &call.channel_id).await? {
            Some(dm) => Some(calls::view(db, &dm, &call).await?),
            None => None,
        },
        None => None,
    };
    Ok((
        read::heads(db, user_id).await?,
        read::dm_heads(db, user_id).await?,
        call,
    ))
}

/// O menor intervalo entre dois `typing` da mesma conexão no mesmo canal. O app
/// manda a cada 3 segundos; o que vier mais rápido não sai para ninguém.
const TYPING_GAP: Duration = Duration::from_secs(2);

/// Uma conexão aberta: de quem é, se o app dela avisou que ninguém mexe no
/// computador, e o último "digitando…" que saiu dela (ADR 0027).
struct Connection<'a> {
    hub: &'a Arc<Hub>,
    db: &'a SqlitePool,
    user_id: &'a str,
    idle: bool,
    last_typing: Option<(String, Instant)>,
}

/// O que o app manda pelo socket, fora o `ping`.
#[derive(Debug, Deserialize, TS)]
#[serde(tag = "type")]
#[ts(export, export_to = "index.ts")]
pub enum ClientEvent {
    /// Ninguém mexe no computador há 10 minutos (`true`), ou voltou (`false`).
    /// O app só manda quando muda.
    #[serde(rename = "idle")]
    Idle { idle: bool },
    /// A pessoa está escrevendo no canal ou na conversa `channel_id`.
    #[serde(rename = "typing")]
    Typing { channel_id: String },
}

impl Connection<'_> {
    async fn handle(&mut self, event: ClientEvent) {
        match event {
            ClientEvent::Idle { idle } => {
                if idle != self.idle {
                    self.idle = idle;
                    self.hub.set_idle(self.user_id, idle);
                }
            }
            ClientEvent::Typing { channel_id } => {
                if let Err(error) = self.typing(channel_id).await {
                    eprintln!("realtime: não deu para repassar o digitando: {error}");
                }
            }
        }
    }

    /// Repassa o "digitando…" para quem pode ler o canal, menos a pessoa. O
    /// Invisível não manda nada, e um canal que ela não lê (ou que não existe)
    /// é ignorado em silêncio.
    async fn typing(&mut self, channel_id: String) -> Result<(), ApiError> {
        if self.hub.status(self.user_id) == Some(Status::Invisible) {
            return Ok(());
        }
        let now = Instant::now();
        if let Some((last, at)) = &self.last_typing
            && *last == channel_id
            && now.duration_since(*at) < TYPING_GAP
        {
            return Ok(());
        }
        let Some(user) = users::find_by_id(self.db, self.user_id).await? else {
            return Ok(());
        };
        let to = match access::readable(self.db, &user, &channel_id).await {
            Ok(Readable::Text(channel)) => access::audience(self.db, &channel.id).await?,
            Ok(Readable::Dm(dm)) => Audience::Only(dm.members.iter().cloned().collect()),
            Err(ApiError::NotFound(_)) => return Ok(()),
            Err(error) => return Err(error),
        };
        self.last_typing = Some((channel_id.clone(), now));
        self.hub.publish_in(
            &ServerEvent::Typing {
                channel_id,
                user_id: self.user_id.to_owned(),
            },
            to.without(self.user_id),
        );
        Ok(())
    }
}

async fn serve(
    connection: &mut Connection<'_>,
    socket: &mut WebSocket,
    events: &mut tokio::sync::broadcast::Receiver<Signal>,
) {
    let user_id = connection.user_id;
    let mut deadline = Instant::now() + IDLE_TIMEOUT;
    loop {
        tokio::select! {
            incoming = socket.recv() => {
                let Some(Ok(message)) = incoming else { return };
                deadline = Instant::now() + IDLE_TIMEOUT;
                match message {
                    Message::Text(text) if text.as_str() == "ping" => {
                        if !send(socket, &ServerEvent::Pong).await {
                            return;
                        }
                    }
                    Message::Text(text) => {
                        // Um evento que esta versão não conhece só conta como vida.
                        if let Ok(event) = serde_json::from_str::<ClientEvent>(text.as_str()) {
                            connection.handle(event).await;
                        }
                    }
                    Message::Close(_) => return,
                    _ => {}
                }
            }
            signal = events.recv() => match signal {
                // O evento de outra pessoa morre aqui, antes do socket: é esta
                // linha que mantém uma conversa privada só entre os dois.
                Ok(Signal::Event { to, .. }) if !to.includes(user_id) => {}
                Ok(Signal::Event { json, .. }) => {
                    if socket.send(Message::Text(json)).await.is_err() {
                        return;
                    }
                }
                Ok(Signal::Close { user_id: closed }) if closed == user_id => {
                    close(socket, CLOSE_SESSION_ENDED, "Sua sessão terminou.").await;
                    return;
                }
                Ok(Signal::Close { .. }) => {}
                Err(RecvError::Lagged(_)) => {
                    close(socket, CLOSE_LAGGED, "Conexão atrasada: reconecte.").await;
                    return;
                }
                Err(RecvError::Closed) => return,
            },
            () = sleep_until(deadline) => return,
        }
    }
}

/// Manda um evento; `false` se a conexão já caiu.
async fn send(socket: &mut WebSocket, event: &ServerEvent) -> bool {
    let json = serde_json::to_string(event).expect("evento sempre vira JSON");
    socket.send(Message::Text(json.into())).await.is_ok()
}

async fn close(socket: &mut WebSocket, code: u16, reason: &'static str) {
    let _ = socket
        .send(Message::Close(Some(CloseFrame {
            code,
            reason: reason.into(),
        })))
        .await;
}
