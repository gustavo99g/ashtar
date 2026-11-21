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

use crate::calls::{CallOutcome, CallView};
use crate::chat::messages::Message;
use crate::chat::read::{ChannelHead, ReadState};
use crate::identity::status::{Shown, Status};
use crate::identity::users::Person;
use crate::logs::LogReportView;
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
    /// O primeiro evento de toda conexão, só para ela: quem é, o status dela,
    /// quem está online agora (sem os invisíveis) e quem desses está ocupado ou
    /// ausente, e
    /// cada canal de texto e conversa privada dela com a mensagem mais
    /// nova e o estado de leitura. Se a pessoa está numa ligação (tocando ou
    /// atendida), ela vem no `call`: é o que acerta quem reconecta no meio.
    #[serde(rename = "ready")]
    Ready {
        user_id: String,
        status: Status,
        online: Vec<String>,
        busy: Vec<String>,
        away: Vec<String>,
        channels: Vec<ChannelHead>,
        dms: Vec<ChannelHead>,
        call: Option<CallView>,
    },
    /// A resposta ao `ping` que o app manda a cada 25 segundos.
    #[serde(rename = "pong")]
    Pong,
    #[serde(rename = "message.created")]
    MessageCreated { message: Message },
    /// A mensagem mudou (texto editado, reações, fixada): vai a mensagem inteira.
    /// `new_mentions` traz só quem a edição passou a mencionar, para o app
    /// notificar sem repetir quem já tinha sido avisado.
    #[serde(rename = "message.updated")]
    MessageUpdated {
        message: Message,
        new_mentions: Vec<String>,
    },
    /// Só para o dono: o disco do servidor passou de 80% (ADR 0031), no máximo uma vez por dia.
    #[serde(rename = "disk.alert")]
    DiskAlert {
        #[ts(type = "number")]
        free_bytes: u64,
        #[ts(type = "number")]
        total_bytes: u64,
    },
    /// A mensagem foi excluída (ADR 0032).
    #[serde(rename = "message.deleted")]
    MessageDeleted {
        channel_id: String,
        message_id: String,
    },
    /// Alguém ficou online ou offline, ou trocou entre disponível, ausente e
    /// ocupado.
    /// Ficar invisível sai daqui como ficar offline. O `status` só quer dizer
    /// alguma coisa com `online`.
    #[serde(rename = "presence.changed")]
    PresenceChanged {
        user_id: String,
        online: bool,
        status: Shown,
    },
    /// A pessoa trocou o próprio status. Só vai para as conexões dela, com o
    /// status de verdade: é o que acerta o outro computador.
    #[serde(rename = "status.changed")]
    StatusChanged { status: Status },
    /// A lista inteira de quem está numa sala de voz, sempre que ela muda.
    #[serde(rename = "voice.participants")]
    VoiceParticipants {
        channel_id: String,
        participants: Vec<ParticipantView>,
    },
    /// Alguém com "Mover membros" pôs a pessoa em outra sala (ADR 0026). Só vai
    /// para as conexões dela: o app troca de sala sozinho, sem perguntar.
    #[serde(rename = "voice.moved")]
    VoiceMoved {
        channel_id: String,
        by: String,
        /// O nome de quem moveu, para o aviso.
        by_name: String,
    },
    /// A pessoa foi tirada da voz: por alguém com "Mover membros", ou porque
    /// perdeu o acesso à sala restrita (ADR 0028). Só vai para as conexões dela:
    /// o app sai da sala com o aviso e não tenta voltar.
    #[serde(rename = "voice.disconnected")]
    VoiceDisconnected {
        by: String,
        by_name: String,
        reason: DisconnectReason,
    },
    /// Alguém está escrevendo no canal ou na conversa (ADR 0027). Vai para quem
    /// pode ler, menos a própria pessoa; o app esquece depois de 6 segundos sem
    /// outro.
    #[serde(rename = "typing")]
    Typing { channel_id: String, user_id: String },
    #[serde(rename = "member.joined")]
    MemberJoined { person: Person },
    /// Alguém trocou o nome visível ou a foto (ADR 0031): vai para todos, e o app troca nas
    /// listas, nas mensagens já carregadas e na sala de voz sem recarregar.
    #[serde(rename = "user.updated")]
    UserUpdated {
        id: String,
        display_name: Option<String>,
        avatar: Option<String>,
    },
    /// Alguém foi removido: sai da coluna de membros.
    #[serde(rename = "member.left")]
    MemberLeft { user_id: String },
    /// Chegaram logs de alguém (v0.6): só para o dono, que vê o aviso no canto.
    #[serde(rename = "logs.received")]
    LogsReceived { report: LogReportView },
    /// A lista de canais mudou (criar, editar, arquivar, reordenar): o app
    /// recarrega o `GET /api/channels`.
    #[serde(rename = "channels.changed")]
    ChannelsChanged { version: i64 },
    /// Os emojis do grupo mudaram (um novo, um nome, uma exclusão): a lista inteira.
    #[serde(rename = "emojis.changed")]
    EmojisChanged {
        emojis: Vec<crate::chat::emojis::Emoji>,
    },
    /// O estado de um canal ou conversa mudou para a pessoa (leu, marcou tudo
    /// como lido, silenciou). Só vai para as conexões dela: é o que zera o
    /// número no outro computador.
    #[serde(rename = "channel.state")]
    ChannelState {
        channel_id: String,
        state: ReadState,
    },
    /// Uma ligação começou a tocar (ADR 0023). Como os outros `call.*`, só vai
    /// para as duas pessoas da conversa.
    #[serde(rename = "call.ringing")]
    CallRinging { call: CallView },
    /// A ligação foi atendida: os dois pedem o token da sala da conversa.
    #[serde(rename = "call.accepted")]
    CallAccepted { call: CallView },
    /// A ligação acabou, de qualquer jeito. A `duration`, em segundos, só vem
    /// na atendida. O registro no histórico chega logo depois, pelo
    /// `message.created`.
    #[serde(rename = "call.ended")]
    CallEnded {
        call_id: String,
        channel_id: String,
        outcome: CallOutcome,
        duration: Option<i64>,
    },
}

impl ServerEvent {
    /// Se o evento é de um canal de texto ou de uma sala de voz, e por isso só
    /// pode sair para quem acessa o canal (ADR 0028). O `match` não tem `_`: um
    /// evento novo não compila sem dizer se é de canal.
    pub fn of_channel(&self) -> bool {
        match self {
            Self::MessageCreated { .. }
            | Self::MessageUpdated { .. }
            | Self::MessageDeleted { .. }
            | Self::VoiceParticipants { .. }
            | Self::Typing { .. }
            | Self::ChannelState { .. }
            | Self::VoiceMoved { .. }
            | Self::CallRinging { .. }
            | Self::CallAccepted { .. }
            | Self::CallEnded { .. } => true,
            Self::Ready { .. }
            | Self::Pong
            | Self::PresenceChanged { .. }
            | Self::StatusChanged { .. }
            | Self::VoiceDisconnected { .. }
            | Self::MemberJoined { .. }
            | Self::UserUpdated { .. }
            | Self::MemberLeft { .. }
            | Self::LogsReceived { .. }
            | Self::DiskAlert { .. }
            | Self::EmojisChanged { .. }
            | Self::ChannelsChanged { .. } => false,
        }
    }
}

/// Por que a pessoa saiu da voz sem pedir.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
pub enum DisconnectReason {
    /// Alguém com "Mover membros" desconectou.
    Moderator,
    /// Saiu da lista da sala restrita, ou a sala ficou restrita sem ela.
    NoAccess,
}

/// Quem recebe um evento.
#[derive(Debug, Clone)]
pub enum Audience {
    Everyone,
    /// Só as conexões destas pessoas (ids de usuário).
    Only(Arc<[String]>),
    /// Todos, menos estas pessoas (quem está digitando não recebe o próprio
    /// aviso).
    Except(Arc<[String]>),
}

impl Audience {
    pub fn includes(&self, user_id: &str) -> bool {
        match self {
            Self::Everyone => true,
            Self::Only(ids) => ids.iter().any(|id| id == user_id),
            Self::Except(ids) => !ids.iter().any(|id| id == user_id),
        }
    }

    /// O mesmo público, sem `user_id`.
    pub fn without(self, user_id: &str) -> Self {
        match self {
            Self::Everyone => Self::Except(Arc::from([user_id.to_owned()])),
            Self::Only(ids) => {
                Self::Only(ids.iter().filter(|id| *id != user_id).cloned().collect())
            }
            Self::Except(ids) => Self::Except(
                ids.iter()
                    .cloned()
                    .chain(std::iter::once(user_id.to_owned()))
                    .collect(),
            ),
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

/// Quantas conexões a pessoa tem. Estar no mapa é estar conectado; o `epoch`
/// muda a cada conexão nova e cancela o "offline" que estava esperando. O
/// `status` fica aqui para o `ready` e o `presence.changed` não irem ao banco:
/// quem está no mapa com `Invisible` está conectado, mas não online para os
/// outros. `idle` conta as conexões cujo app avisou que ninguém mexe no
/// computador (ADR 0027).
struct Presence {
    connections: usize,
    idle: usize,
    epoch: u64,
    status: Status,
}

impl Presence {
    /// O que os outros veem: o status escolhido, e Disponível vira Ausente
    /// quando todas as conexões estão ociosas.
    fn shown(&self) -> Option<Shown> {
        match self.status.shown()? {
            Shown::Available if self.connections > 0 && self.idle == self.connections => {
                Some(Shown::Away)
            }
            shown => Some(shown),
        }
    }
}

#[derive(Default)]
struct Inner {
    tickets: HashMap<String, Ticket>,
    presence: HashMap<String, Presence>,
    /// Para cada sala, o número da última releitura pedida ao LiveKit: uma
    /// resposta velha que chega depois da nova não é publicada.
    voice_reads: HashMap<String, u64>,
    /// Quem está em cada sala de voz, pela última lista publicada
    /// (`voice.participants`). As salas das ligações privadas nunca entram.
    voice_rooms: HashMap<String, Vec<String>>,
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
    /// nada. Um evento de um canal não passa por aqui: ele vai pelo
    /// [`Hub::publish_in`], com quem acessa o canal ([`ServerEvent::of_channel`]).
    pub fn publish(&self, event: &ServerEvent) {
        debug_assert!(
            !event.of_channel(),
            "evento de canal publicado para todos: use o publish_in"
        );
        self.send(event, Audience::Everyone);
    }

    /// Manda um evento de um canal para quem o acessa, pela
    /// `chat::access::audience` (ADR 0028).
    pub fn publish_in(&self, event: &ServerEvent, to: Audience) {
        self.send(event, to);
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

    fn presence_changed(&self, user_id: &str, shown: Option<Shown>) {
        self.publish(&ServerEvent::PresenceChanged {
            user_id: user_id.to_owned(),
            online: shown.is_some(),
            status: shown.unwrap_or(Shown::Available),
        });
    }

    /// Uma conexão nova de `user_id`, que está com `status`. A primeira o
    /// deixa online para os outros, a não ser que esteja invisível.
    pub fn connect(&self, user_id: &str, status: Status) {
        let mut inner = self.lock();
        let presence = inner
            .presence
            .entry(user_id.to_owned())
            .or_insert(Presence {
                connections: 0,
                idle: 0,
                epoch: 0,
                status,
            });
        let before = (presence.epoch > 0).then(|| presence.shown()).flatten();
        presence.connections += 1;
        presence.epoch += 1;
        let after = presence.shown();
        drop(inner);
        if before != after {
            self.presence_changed(user_id, after);
        }
    }

    /// Uma conexão de `user_id` caiu (`idle`: se ela estava ociosa). Se era a
    /// última, ele fica offline depois de [`OFFLINE_DELAY`], a não ser que
    /// volte antes. O invisível sai sem aviso: para os outros, ele já estava
    /// offline. Se sobrou conexão, a que caiu pode ter sido a única que
    /// segurava o Disponível.
    pub fn disconnect(self: &Arc<Self>, user_id: &str, idle: bool) {
        let mut inner = self.lock();
        let Some(presence) = inner.presence.get_mut(user_id) else {
            return;
        };
        let before = presence.shown();
        presence.connections = presence.connections.saturating_sub(1);
        if idle {
            presence.idle = presence.idle.saturating_sub(1);
        }
        if presence.connections > 0 {
            let after = presence.shown();
            drop(inner);
            if before != after {
                self.presence_changed(user_id, after);
            }
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
            let was_shown = inner
                .presence
                .remove(&user_id)
                .is_some_and(|p| p.shown().is_some());
            drop(inner);
            if was_shown {
                hub.presence_changed(&user_id, None);
            }
        });
    }

    /// `user_id` trocou de status. Para os outros sai só o que eles podem ver,
    /// e só se a pessoa está conectada: entrar em invisível é ficar offline,
    /// sair dele é ficar online, e entre disponível e ocupado muda o `status`.
    /// Para as conexões dela vai o status de verdade.
    pub fn set_status(&self, user_id: &str, status: Status) {
        let mut inner = self.lock();
        let change = inner.presence.get_mut(user_id).map(|presence| {
            let before = presence.shown();
            presence.status = status;
            (before, presence.shown())
        });
        drop(inner);
        if let Some((before, after)) = change
            && before != after
        {
            self.presence_changed(user_id, after);
        }
        self.publish_to(&[user_id], &ServerEvent::StatusChanged { status });
    }

    /// Uma conexão de `user_id` ficou ociosa (`idle`) ou voltou (ADR 0027).
    /// Quem chama guarda o estado da própria conexão e só avisa quando muda.
    pub fn set_idle(&self, user_id: &str, idle: bool) {
        let mut inner = self.lock();
        let Some(presence) = inner.presence.get_mut(user_id) else {
            return;
        };
        let before = presence.shown();
        if idle {
            presence.idle = (presence.idle + 1).min(presence.connections);
        } else {
            presence.idle = presence.idle.saturating_sub(1);
        }
        let after = presence.shown();
        drop(inner);
        if before != after {
            self.presence_changed(user_id, after);
        }
    }

    /// Quem está online para os outros agora, em ordem de id, com o que eles
    /// veem. Os invisíveis não entram.
    pub fn online(&self) -> Vec<(String, Shown)> {
        let mut online: Vec<(String, Shown)> = self
            .lock()
            .presence
            .iter()
            .filter_map(|(id, presence)| Some((id.clone(), presence.shown()?)))
            .collect();
        online.sort_by(|a, b| a.0.cmp(&b.0));
        online
    }

    /// O que os outros veem de `user_id`: `None` se está offline ou invisível.
    pub fn shown(&self, user_id: &str) -> Option<Shown> {
        self.lock().presence.get(user_id)?.shown()
    }

    /// O status que `user_id` escolheu, se está conectado.
    pub fn status(&self, user_id: &str) -> Option<Status> {
        Some(self.lock().presence.get(user_id)?.status)
    }

    /// Se `user_id` tem conexão (ou caiu há menos que o atraso), em qualquer
    /// status.
    pub fn is_connected(&self, user_id: &str) -> bool {
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

    /// Publica a lista de quem está na sala `room` para `to` (quem acessa a sala)
    /// e guarda quem é, para saber em que sala cada pessoa está
    /// ([`Hub::room_of`]).
    pub fn publish_voice_participants(
        &self,
        room: String,
        participants: Vec<ParticipantView>,
        to: Audience,
    ) {
        let ids: Vec<String> = participants.iter().map(|p| p.user_id.clone()).collect();
        {
            let mut inner = self.lock();
            if ids.is_empty() {
                inner.voice_rooms.remove(&room);
            } else {
                inner.voice_rooms.insert(room.clone(), ids);
            }
        }
        self.publish_in(
            &ServerEvent::VoiceParticipants {
                channel_id: room,
                participants,
            },
            to,
        );
    }

    /// A sala de voz em que `user_id` está, pela última lista de cada sala.
    pub fn room_of(&self, user_id: &str) -> Option<String> {
        self.lock()
            .voice_rooms
            .iter()
            .find(|(_, ids)| ids.iter().any(|id| id == user_id))
            .map(|(room, _)| room.clone())
    }

    /// Quem está na sala `room` agora, pela última lista publicada.
    pub fn people_in(&self, room: &str) -> Vec<String> {
        self.lock()
            .voice_rooms
            .get(room)
            .cloned()
            .unwrap_or_default()
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
            status: Shown::Busy,
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "type": "presence.changed", "user_id": "u1", "online": true, "status": "busy"
            })
        );
        let pong = serde_json::to_value(ServerEvent::Pong).unwrap();
        assert_eq!(pong, serde_json::json!({ "type": "pong" }));
    }

    #[tokio::test]
    async fn fica_offline_so_depois_do_atraso() {
        let hub = Arc::new(Hub::new(Duration::from_millis(50)));
        let mut rx = hub.subscribe();

        hub.connect("u1", Status::Available);
        assert_eq!(next_event(&mut rx)["online"], true);
        // A segunda conexão não repete o aviso.
        hub.connect("u1", Status::Available);
        assert!(rx.try_recv().is_err());

        hub.disconnect("u1", false);
        hub.disconnect("u1", false);
        assert!(hub.is_connected("u1"), "ainda dentro do atraso");
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!hub.is_connected("u1"));
        assert_eq!(next_event(&mut rx)["online"], false);
    }

    #[tokio::test]
    async fn voltar_dentro_do_atraso_nao_pisca() {
        let hub = Arc::new(Hub::new(Duration::from_millis(50)));
        hub.connect("u1", Status::Available);
        let mut rx = hub.subscribe();

        hub.disconnect("u1", false);
        hub.connect("u1", Status::Available);
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(hub.is_connected("u1"));
        assert!(rx.try_recv().is_err(), "nem offline nem online de novo");
    }

    /// O próximo sinal, com quem o recebe.
    fn next_signal(rx: &mut broadcast::Receiver<Signal>) -> (serde_json::Value, Audience) {
        match rx.try_recv().expect("deveria ter um evento") {
            Signal::Event { json, to } => (serde_json::from_str(json.as_str()).unwrap(), to),
            Signal::Close { .. } => panic!("esperava um evento"),
        }
    }

    #[tokio::test]
    async fn o_invisivel_conecta_e_sai_sem_ninguem_ver() {
        let hub = Arc::new(Hub::new(Duration::from_millis(20)));
        let mut rx = hub.subscribe();

        hub.connect("u1", Status::Invisible);
        assert!(hub.is_connected("u1"));
        assert_eq!(hub.shown("u1"), None);
        assert_eq!(hub.online(), []);
        hub.disconnect("u1", false);
        tokio::time::sleep(Duration::from_millis(60)).await;
        assert!(!hub.is_connected("u1"));
        assert!(rx.try_recv().is_err(), "nenhum aviso de presença");
    }

    #[test]
    fn trocar_de_status_mostra_aos_outros_so_o_que_eles_podem_ver() {
        let hub = Hub::default();
        hub.connect("u1", Status::Available);
        let mut rx = hub.subscribe();

        // Ocupado: todos veem a troca, e a pessoa recebe o status de verdade.
        hub.set_status("u1", Status::Busy);
        let (event, to) = next_signal(&mut rx);
        assert_eq!(event["type"], "presence.changed");
        assert_eq!(
            (&event["online"], &event["status"]),
            (&true.into(), &"busy".into())
        );
        assert!(to.includes("u2"));
        let (event, to) = next_signal(&mut rx);
        assert_eq!(
            event,
            serde_json::json!({ "type": "status.changed", "status": "busy" })
        );
        assert!(to.includes("u1") && !to.includes("u2"));
        assert_eq!(hub.online(), [("u1".to_owned(), Shown::Busy)]);

        // Invisível: para os outros, ficou offline. A palavra não sai para eles.
        hub.set_status("u1", Status::Invisible);
        let (event, _) = next_signal(&mut rx);
        assert_eq!(
            event,
            serde_json::json!({
                "type": "presence.changed", "user_id": "u1", "online": false, "status": "available"
            })
        );
        let (event, to) = next_signal(&mut rx);
        assert_eq!(event["status"], "invisible");
        assert!(!to.includes("u2"));
        assert_eq!(hub.online(), []);

        // De volta: online de novo.
        hub.set_status("u1", Status::Available);
        let (event, _) = next_signal(&mut rx);
        assert_eq!(
            (&event["online"], &event["status"]),
            (&true.into(), &"available".into())
        );
    }

    #[test]
    fn quem_nao_esta_conectado_troca_de_status_sem_aviso_aos_outros() {
        let hub = Hub::default();
        let mut rx = hub.subscribe();
        hub.set_status("u1", Status::Busy);
        let (event, to) = next_signal(&mut rx);
        assert_eq!(event["type"], "status.changed");
        assert!(!to.includes("u2"));
        assert!(rx.try_recv().is_err());
    }

    fn person(id: &str) -> ParticipantView {
        ParticipantView {
            user_id: id.into(),
            nick: id.into(),
            display_name: None,
            screen_sharing: false,
            avatar: None,
        }
    }

    #[test]
    fn o_hub_sabe_em_que_sala_cada_um_esta() {
        let hub = Hub::default();
        let mut rx = hub.subscribe();
        hub.publish_voice_participants(
            "sala".into(),
            vec![person("u1"), person("u2")],
            Audience::Everyone,
        );
        hub.publish_voice_participants("squad".into(), vec![person("u3")], Audience::Everyone);
        assert_eq!(next_event(&mut rx)["type"], "voice.participants");
        assert_eq!(hub.room_of("u2").as_deref(), Some("sala"));
        assert_eq!(hub.room_of("u3").as_deref(), Some("squad"));
        assert_eq!(hub.room_of("u4"), None);

        // Trocou de sala: sai de uma lista e entra na outra.
        hub.publish_voice_participants("sala".into(), vec![person("u1")], Audience::Everyone);
        hub.publish_voice_participants(
            "squad".into(),
            vec![person("u3"), person("u2")],
            Audience::Everyone,
        );
        assert_eq!(hub.room_of("u2").as_deref(), Some("squad"));
        assert_eq!(hub.people_in("squad"), ["u3", "u2"]);

        // A sala vazia some.
        hub.publish_voice_participants("squad".into(), vec![], Audience::Everyone);
        assert_eq!(hub.room_of("u3"), None);
        assert!(hub.people_in("squad").is_empty());
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
