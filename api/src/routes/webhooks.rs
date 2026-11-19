//! `POST /webhooks/livekit`: o LiveKit avisa quando alguém entra ou sai de uma
//! sala, ou liga e desliga a tela. A API relê a sala e manda a lista inteira
//! pelo WebSocket (`voice.participants`).
//!
//! Fora do `/api` e da `ClientPolicy`: quem chama é o LiveKit, não o app. A
//! assinatura (um JWT com o SHA-256 do corpo, feito com a chave da API do
//! LiveKit) é conferida antes de tudo.
//!
//! A sala de uma ligação privada (o nome é o id de uma conversa, ADR 0023)
//! nunca vira `voice.participants`: contaria a todos quem está falando com
//! quem. Nela, a saída de um dos dois (ou o fim da sala) encerra a ligação.

use axum::extract::State;
use axum::http::header::AUTHORIZATION;
use axum::http::{HeaderMap, StatusCode};
use livekit_protocol::WebhookEvent;

use super::calls::announce_ended;
use crate::AppState;
use crate::calls;
use crate::chat::dms;
use crate::db::now;
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

/// Os eventos que, numa sala de ligação, querem dizer que um dos dois saiu.
const LEAVES: [&str; 2] = ["participant_left", "participant_connection_aborted"];

/// Se o evento, numa sala de ligação privada, encerra a ligação: a sala fechou,
/// ou saiu a voz de alguém. A saída da tela (`:screen`) é só o fim da
/// transmissão.
pub fn ends_call(event: &WebhookEvent) -> bool {
    if event.event == "room_finished" {
        return true;
    }
    LEAVES.contains(&event.event.as_str())
        && event
            .participant
            .as_ref()
            .is_some_and(|p| !p.identity.ends_with(voice::SCREEN_SUFFIX))
}

/// Encerra a ligação da conversa `dm`, se o evento pede e ela está atendida.
async fn end_call(state: AppState, dm: dms::Dm) {
    match calls::end_by_room(&state.db, &dm, now()).await {
        Ok(Some(ended)) => announce_ended(&state, &ended),
        Ok(None) => {}
        Err(error) => eprintln!(
            "webhook: não deu para encerrar a ligação {}: {error}",
            dm.id
        ),
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
    // A sala de uma ligação privada: nada sai para todos.
    if let Some(room) = event.room.as_ref() {
        match dms::get(&state.db, &room.name).await {
            Ok(Some(dm)) => {
                if ends_call(&event) {
                    end_call(state.clone(), dm).await;
                }
                return StatusCode::OK;
            }
            Ok(None) => {}
            Err(error) => {
                // Sem saber se é privada, não publica nada: o LiveKit tenta de novo.
                eprintln!("webhook: não deu para ler a sala {}: {error}", room.name);
                return StatusCode::INTERNAL_SERVER_ERROR;
            }
        }
    }
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
    use livekit_protocol::{ParticipantInfo, Room};

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

    fn with_participant(name: &str, identity: &str) -> WebhookEvent {
        WebhookEvent {
            participant: Some(ParticipantInfo {
                identity: identity.into(),
                ..Default::default()
            }),
            ..event(name, Some("conversa"))
        }
    }

    #[test]
    fn a_ligacao_acaba_quando_sai_a_voz_de_um_dos_dois() {
        assert!(ends_call(&with_participant("participant_left", "kid")));
        assert!(ends_call(&with_participant(
            "participant_connection_aborted",
            "kid"
        )));
        assert!(ends_call(&event("room_finished", Some("conversa"))));
        // A tela que para não derruba a ligação.
        assert!(!ends_call(&with_participant(
            "participant_left",
            "kid:screen"
        )));
        assert!(!ends_call(&with_participant("participant_joined", "kid")));
        assert!(!ends_call(&with_participant("track_unpublished", "kid")));
    }
}
