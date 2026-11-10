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
use crate::chat::messages::{self, ChannelHead};
use crate::error::ApiError;
use crate::identity::users;
use crate::realtime::{Hub, ServerEvent, Signal, TICKET_TTL};

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
    hub.connect(&user_id);
    let mut events = hub.subscribe();
    match heads(&db, &user_id).await {
        Ok((channels, dms)) => {
            let ready = ServerEvent::Ready {
                user_id: user_id.clone(),
                online: hub.online(),
                channels,
                dms,
            };
            if send(&mut socket, &ready).await {
                serve(&user_id, &mut socket, &mut events).await;
            }
        }
        Err(error) => {
            eprintln!("realtime: não deu para montar o ready: {error}");
            close(&mut socket, CLOSE_INTERNAL, "Erro no servidor: reconecte.").await;
        }
    }
    hub.disconnect(&user_id);
}

/// O que o `ready` leva do chat: os canais de texto, que são de todos, e as
/// conversas privadas de `user_id`.
async fn heads(
    db: &SqlitePool,
    user_id: &str,
) -> Result<(Vec<ChannelHead>, Vec<ChannelHead>), ApiError> {
    Ok((
        messages::heads(db).await?,
        messages::dm_heads(db, user_id).await?,
    ))
}

async fn serve(
    user_id: &str,
    socket: &mut WebSocket,
    events: &mut tokio::sync::broadcast::Receiver<Signal>,
) {
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
                    Message::Close(_) => return,
                    // O app não manda mais nada; o que vier só conta como vida.
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
