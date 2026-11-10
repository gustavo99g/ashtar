//! O tempo real: o canal por onde a API avisa o app do que mudou (ADR 0015).
//!
//! Um [`Hub`] para a API inteira. Cada WebSocket aberto assina o mesmo
//! `broadcast` do tokio; quem muda alguma coisa (uma mensagem nova, alguém que
//! entrou na sala) publica um [`ServerEvent`], que vai uma vez para o JSON e
//! sai igual para quem deve receber: todos ([`Hub::publish`]) ou só algumas
//! pessoas ([`Hub::publish_to`], ADR 0021). O hub também guarda os tickets de
//! entrada e quem está online.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::ws::Utf8Bytes;
use serde::Serialize;
use tokio::sync::broadcast;
use ts_rs::TS;

use crate::chat::messages::Message;
use crate::chat::read::{ChannelHead, ReadState};
use crate::identity::users::Person;
use crate::secret;
use crate::voice::ParticipantView;

/// Quanto o ticket vale depois de emitido. O app pede e já conecta.
pub const TICKET_TTL: Duration = Duration::from_secs(30);

/// Quanto esperar, depois da última conexão de alguém cair, antes de dizer que
/// ficou offline. Cobre a troca de rede e o reinício do app sem piscar a lista.
pub const OFFLINE_DELAY: Duration = Duration::from_secs(10);

/// Quantos eventos o `broadcast` guarda para um socket lento. Quem fica para
/// trás disso é desconectado e se reencontra pelo `?after=` (Etapa 5).
const CAPACITY: usize = 256;

/// Tudo o que a API manda pelo WebSocket. O `type` é o nome do evento.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "type")]
#[ts(export, export_to = "index.ts")]
pub enum ServerEvent {
    /// O primeiro evento de toda conexão, só para ela: quem é, quem está online
    /// agora, e cada canal de texto e conversa privada dela com a mensagem mais
    /// nova e o estado de leitura.
    #[serde(rename = "ready")]
    Ready {
        user_id: String,
        online: Vec<String>,
        channels: Vec<ChannelHead>,
        dms: Vec<ChannelHead>,
    },
    /// A resposta ao `ping` que o app manda a cada 25 segundos.
    #[serde(rename = "pong")]
    Pong,
    #[serde(rename = "message.created")]
    MessageCreated { message: Message },
    #[serde(rename = "presence.changed")]
    PresenceChanged { user_id: String, online: bool },
    /// A lista inteira de quem está numa sala de voz, sempre que ela muda.
    #[serde(rename = "voice.participants")]
    VoiceParticipants {
        channel_id: String,
        participants: Vec<ParticipantView>,
    },
    #[serde(rename = "member.joined")]
    MemberJoined { person: Person },
    /// Alguém foi removido: sai da coluna de membros.
    #[serde(rename = "member.left")]
    MemberLeft { user_id: String },
    /// A lista de canais mudou (criar, editar, arquivar, reordenar): o app
    /// recarrega o `GET /api/channels`.
    #[serde(rename = "channels.changed")]
    ChannelsChanged { version: i64 },
    /// O estado de um canal ou conversa mudou para a pessoa (leu, marcou tudo
    /// como lido, silenciou). Só vai para as conexões dela: é o que zera o
    /// número no outro computador.
    #[serde(rename = "channel.state")]
    ChannelState {
        channel_id: String,
        state: ReadState,
    },
}

/// Quem recebe um evento.
#[derive(Debug, Clone)]
pub enum Audience {
    Everyone,
    /// Só as conexões destas pessoas (ids de usuário).
    Only(Arc<[String]>),
}

impl Audience {
    pub fn includes(&self, user_id: &str) -> bool {
        match self {
            Self::Everyone => true,
            Self::Only(ids) => ids.iter().any(|id| id == user_id),
        }
    }
}

/// O que passa pelo `broadcast`: um evento já em JSON, com quem deve
/// recebê-lo, ou a ordem de fechar as conexões de alguém (removido ou
/// desvinculado).
#[derive(Debug, Clone)]
pub enum Signal {
    Event { json: Utf8Bytes, to: Audience },
    Close { user_id: String },
}

struct Ticket {
    user_id: String,
    expires_at: Instant,
}

/// Quantas conexões a pessoa tem. Estar no mapa é estar online; o `epoch`
/// muda a cada conexão nova e cancela o "offline" que estava esperando.
struct Presence {
    connections: usize,
    epoch: u64,
}

#[derive(Default)]
struct Inner {
    tickets: HashMap<String, Ticket>,
    presence: HashMap<String, Presence>,
    /// Para cada sala, o número da última releitura pedida ao LiveKit: uma
    /// resposta velha que chega depois da nova não é publicada.
    voice_reads: HashMap<String, u64>,
}

pub struct Hub {
    tx: broadcast::Sender<Signal>,
    inner: Mutex<Inner>,
    offline_delay: Duration,
}

impl Hub {
    pub fn new(offline_delay: Duration) -> Self {
        Self {
            tx: broadcast::channel(CAPACITY).0,
            inner: Mutex::default(),
            offline_delay,
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().expect("trava do hub envenenada")
    }

    /// Um ticket de uso único para `user_id`, válido por [`TICKET_TTL`].
    pub fn issue_ticket(&self, user_id: &str) -> String {
        let ticket = secret::new_session_token();
        let mut inner = self.lock();
        let now = Instant::now();
        inner.tickets.retain(|_, t| t.expires_at > now);
        inner.tickets.insert(
            ticket.clone(),
            Ticket {
                user_id: user_id.to_owned(),
                expires_at: now + TICKET_TTL,
            },
        );
        ticket
    }

    /// Gasta o ticket: devolve de quem ele é, se ainda vale. Usado ou vencido,
    /// não vale de novo.
    pub fn redeem_ticket(&self, ticket: &str) -> Option<String> {
        let ticket = self.lock().tickets.remove(ticket)?;
        (ticket.expires_at > Instant::now()).then_some(ticket.user_id)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Signal> {
        self.tx.subscribe()
    }

    /// Manda o evento para todas as conexões. Sem ninguém conectado, não faz
    /// nada.
    pub fn publish(&self, event: &ServerEvent) {
        self.send(event, Audience::Everyone);
    }

    /// Manda o evento só para as conexões de `user_ids`. O evento passa pelo
    /// mesmo `broadcast` dos outros, e é o laço de cada conexão que descarta o
    /// que não é da pessoa dela (`routes/realtime.rs`).
    pub fn publish_to<S: AsRef<str>>(&self, user_ids: &[S], event: &ServerEvent) {
        let ids = user_ids.iter().map(|id| id.as_ref().to_owned()).collect();
        self.send(event, Audience::Only(ids));
    }

    fn send(&self, event: &ServerEvent, to: Audience) {
        let json = serde_json::to_string(event).expect("evento sempre vira JSON");
        let _ = self.tx.send(Signal::Event {
            json: json.into(),
            to,
        });
    }

    /// Uma conexão nova de `user_id`. A primeira o deixa online.
    pub fn connect(&self, user_id: &str) {
        let mut inner = self.lock();
        let presence = inner
            .presence
            .entry(user_id.to_owned())
            .or_insert(Presence {
                connections: 0,
                epoch: 0,
            });
        let came_online = presence.connections == 0 && presence.epoch == 0;
        presence.connections += 1;
        presence.epoch += 1;
        drop(inner);
        if came_online {
            self.publish(&ServerEvent::PresenceChanged {
                user_id: user_id.to_owned(),
                online: true,
            });
        }
    }

    /// Uma conexão de `user_id` caiu. Se era a última, ele fica offline depois
    /// de [`OFFLINE_DELAY`], a não ser que volte antes.
    pub fn disconnect(self: &Arc<Self>, user_id: &str) {
        let mut inner = self.lock();
        let Some(presence) = inner.presence.get_mut(user_id) else {
            return;
        };
        presence.connections = presence.connections.saturating_sub(1);
        if presence.connections > 0 {
            return;
        }
        let epoch = presence.epoch;
        drop(inner);

        let hub = Arc::clone(self);
        let user_id = user_id.to_owned();
        tokio::spawn(async move {
            tokio::time::sleep(hub.offline_delay).await;
            let mut inner = hub.lock();
            let still_gone = inner
                .presence
                .get(&user_id)
                .is_some_and(|p| p.connections == 0 && p.epoch == epoch);
            if !still_gone {
                return;
            }
            inner.presence.remove(&user_id);
            drop(inner);
            hub.publish(&ServerEvent::PresenceChanged {
                user_id,
                online: false,
            });
        });
    }

    /// Quem está online agora, em ordem de id.
    pub fn online(&self) -> Vec<String> {
        let mut online: Vec<String> = self.lock().presence.keys().cloned().collect();
        online.sort();
        online
    }

    pub fn is_online(&self, user_id: &str) -> bool {
        self.lock().presence.contains_key(user_id)
    }

    /// Fecha toda conexão de `user_id` (código 4001) e joga fora os tickets
    /// dele. O app, ao ver o 4001, pede um ticket novo e recebe 401.
    pub fn close_user(&self, user_id: &str) {
        self.lock().tickets.retain(|_, t| t.user_id != user_id);
        let _ = self.tx.send(Signal::Close {
            user_id: user_id.to_owned(),
        });
    }

    /// Começa uma releitura da sala `room` e devolve o número dela.
    pub fn start_voice_read(&self, room: &str) -> u64 {
        let mut inner = self.lock();
        let n = inner.voice_reads.entry(room.to_owned()).or_default();
        *n += 1;
        *n
    }

    /// Se a releitura `n` ainda é a última pedida para `room`.
    pub fn is_latest_voice_read(&self, room: &str, n: u64) -> bool {
        self.lock().voice_reads.get(room) == Some(&n)
    }
}

impl Default for Hub {
    fn default() -> Self {
        Self::new(OFFLINE_DELAY)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn next_event(rx: &mut broadcast::Receiver<Signal>) -> serde_json::Value {
        match rx.try_recv().expect("deveria ter um evento") {
            Signal::Event { json, .. } => serde_json::from_str(json.as_str()).unwrap(),
            Signal::Close { .. } => panic!("esperava um evento"),
        }
    }

    #[test]
    fn o_evento_com_destinatario_e_so_de_quem_foi_nomeado() {
        let hub = Hub::default();
        let mut rx = hub.subscribe();

        hub.publish(&ServerEvent::Pong);
        hub.publish_to(&["u1", "u2"], &ServerEvent::Pong);

        let Signal::Event { to, .. } = rx.try_recv().unwrap() else {
            panic!("esperava um evento");
        };
        assert!(
            to.includes("u1") && to.includes("u3"),
            "o publish é de todos"
        );
        let Signal::Event { to, .. } = rx.try_recv().unwrap() else {
            panic!("esperava um evento");
        };
        assert!(to.includes("u1") && to.includes("u2"));
        assert!(!to.includes("u3"));
        assert!(!to.includes("u"), "o id é comparado inteiro");
    }

    #[test]
    fn o_ticket_vale_uma_vez() {
        let hub = Hub::default();
        let ticket = hub.issue_ticket("u1");
        assert_eq!(hub.redeem_ticket(&ticket).as_deref(), Some("u1"));
        assert_eq!(hub.redeem_ticket(&ticket), None);
        assert_eq!(hub.redeem_ticket("inventado"), None);
    }

    #[test]
    fn fechar_a_pessoa_joga_fora_os_tickets_dela() {
        let hub = Hub::default();
        let dela = hub.issue_ticket("u1");
        let outro = hub.issue_ticket("u2");
        hub.close_user("u1");
        assert_eq!(hub.redeem_ticket(&dela), None);
        assert_eq!(hub.redeem_ticket(&outro).as_deref(), Some("u2"));
    }

    #[test]
    fn os_eventos_tem_o_nome_no_type() {
        let json = serde_json::to_value(ServerEvent::PresenceChanged {
            user_id: "u1".into(),
            online: true,
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "type": "presence.changed", "user_id": "u1", "online": true })
        );
        let pong = serde_json::to_value(ServerEvent::Pong).unwrap();
        assert_eq!(pong, serde_json::json!({ "type": "pong" }));
    }

    #[tokio::test]
    async fn fica_offline_so_depois_do_atraso() {
        let hub = Arc::new(Hub::new(Duration::from_millis(50)));
        let mut rx = hub.subscribe();

        hub.connect("u1");
        assert_eq!(next_event(&mut rx)["online"], true);
        // A segunda conexão não repete o aviso.
        hub.connect("u1");
        assert!(rx.try_recv().is_err());

        hub.disconnect("u1");
        hub.disconnect("u1");
        assert!(hub.is_online("u1"), "ainda dentro do atraso");
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!hub.is_online("u1"));
        assert_eq!(next_event(&mut rx)["online"], false);
    }

    #[tokio::test]
    async fn voltar_dentro_do_atraso_nao_pisca() {
        let hub = Arc::new(Hub::new(Duration::from_millis(50)));
        hub.connect("u1");
        let mut rx = hub.subscribe();

        hub.disconnect("u1");
        hub.connect("u1");
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(hub.is_online("u1"));
        assert!(rx.try_recv().is_err(), "nem offline nem online de novo");
    }

    #[test]
    fn so_a_ultima_releitura_da_sala_vale() {
        let hub = Hub::default();
        let first = hub.start_voice_read("sala");
        let second = hub.start_voice_read("sala");
        assert!(!hub.is_latest_voice_read("sala", first));
        assert!(hub.is_latest_voice_read("sala", second));
    }
}
