//! `POST /webhooks/livekit`: o LiveKit avisa quando alguém entra ou sai de uma
//! sala, ou liga e desliga a tela. A API relê a sala e manda a lista inteira
//! pelo WebSocket (`voice.participants`).
//!
//! Fora do `/api` e da `ClientPolicy`: quem chama é o LiveKit, não o app. A
//! assinatura (um JWT com o SHA-256 do corpo, feito com a chave da API do
//! LiveKit) é conferida antes de tudo.

use axum::extract::State;
use axum::http::header::AUTHORIZATION;
use axum::http::{HeaderMap, StatusCode};
use livekit_protocol::WebhookEvent;

use crate::AppState;
use crate::realtime::ServerEvent;
use crate::voice;

/// Os eventos que mudam a lista de quem está numa sala.
const ROOM_CHANGES: [&str; 5] = [
    "participant_joined",
    "participant_left",
    "participant_connection_aborted",
    "track_published",
    "track_unpublished",
];

/// O que fazer com um evento do LiveKit.
#[derive(Debug, PartialEq, Eq)]
pub enum RoomUpdate {
    /// Reler a sala e publicar a lista.
    Reread(String),
    /// A sala fechou: a lista é vazia, sem perguntar.
    Empty(String),
}

pub fn room_update(event: &WebhookEvent) -> Option<RoomUpdate> {
    let room = event.room.as_ref()?.name.clone();
    if event.event == "room_finished" {
        Some(RoomUpdate::Empty(room))
    } else if ROOM_CHANGES.contains(&event.event.as_str()) {
        Some(RoomUpdate::Reread(room))
    } else {
        None
    }
}

pub async fn livekit(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: String,
) -> StatusCode {
    let Some(receiver) = state.webhook.as_ref() else {
        // Sem `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` não há como conferir.
        return StatusCode::SERVICE_UNAVAILABLE;
    };
    let auth = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let event = match receiver.receive(&body, auth) {
        Ok(event) => event,
        Err(error) => {
            eprintln!("webhook do livekit recusado: {error}");
            return StatusCode::UNAUTHORIZED;
        }
    };
    match room_update(&event) {
        Some(RoomUpdate::Empty(room)) => {
            state.hub.start_voice_read(&room);
            state.hub.publish(&ServerEvent::VoiceParticipants {
                channel_id: room,
                participants: Vec::new(),
            });
        }
        // Relê à parte: o LiveKit espera a resposta, e a consulta leva até 5 s.
        Some(RoomUpdate::Reread(room)) => {
            tokio::spawn(reread(state.clone(), room));
        }
        None => {}
    }
    StatusCode::OK
}

/// Pergunta ao LiveKit quem está na sala e publica, a não ser que uma releitura
/// mais nova da mesma sala tenha sido pedida enquanto esta esperava.
async fn reread(state: AppState, room: String) {
    let n = state.hub.start_voice_read(&room);
    let participants = match voice::list_room(&room).await {
        Ok(listed) => voice::join_participants(&state.db, listed).await,
        Err(error) => Err(error),
    };
    match participants {
        Ok(participants) if state.hub.is_latest_voice_read(&room, n) => {
            state.hub.publish(&ServerEvent::VoiceParticipants {
                channel_id: room,
                participants,
            });
        }
        Ok(_) => {}
        Err(error) => eprintln!("livekit: não deu para reler a sala {room}: {error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use livekit_protocol::Room;

    fn event(name: &str, room: Option<&str>) -> WebhookEvent {
        WebhookEvent {
            event: name.into(),
            room: room.map(|name| Room {
                name: name.into(),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    #[test]
    fn so_o_que_muda_a_lista_rele_a_sala() {
        assert_eq!(
            room_update(&event("participant_joined", Some("sala"))),
            Some(RoomUpdate::Reread("sala".into()))
        );
        assert_eq!(
            room_update(&event("track_unpublished", Some("sala"))),
            Some(RoomUpdate::Reread("sala".into()))
        );
        assert_eq!(
            room_update(&event("room_finished", Some("sala"))),
            Some(RoomUpdate::Empty("sala".into()))
        );
        assert_eq!(room_update(&event("room_started", Some("sala"))), None);
        assert_eq!(room_update(&event("egress_ended", Some("sala"))), None);
        assert_eq!(room_update(&event("participant_joined", None)), None);
    }
}
