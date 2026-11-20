//! A voz no LiveKit: quem está numa sala, tirar alguém de todas as salas e as
//! chaves do ambiente.
//!
//! As rotas de voz (`routes/voice.rs`), as de membros e o webhook do LiveKit
//! (`routes/webhooks.rs`) chamam as funções daqui; o tempo real (`realtime`)
//! leva a [`ParticipantView`] no `voice.participants`.

use std::collections::HashMap;
use std::env;
use std::sync::OnceLock;
use std::time::Duration;

use livekit_api::services::room::RoomClient;
use livekit_api::services::{ServerError, ServerErrorCode, ServiceError};
use livekit_protocol::{ParticipantInfo, TrackSource};
use serde::Serialize;
use sqlx::SqlitePool;
use ts_rs::TS;

use crate::error::ApiError;
use crate::identity::{User, users};

/// Uma pessoa na sala, com o nick e o nome visível do banco.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct ParticipantView {
    pub user_id: String,
    pub nick: String,
    pub display_name: Option<String>,
    /// Se está transmitindo a tela (o selo TRANSMITINDO).
    pub screen_sharing: bool,
}

/// Quem o LiveKit diz que está na sala: a identidade do token (o id do membro)
/// e se tem uma trilha de tela publicada.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomParticipant {
    pub identity: String,
    pub screen_sharing: bool,
}

/// O fim da identidade da conexão que transmite a tela de alguém (`{user_id}:screen`): o app
/// entra na sala duas vezes, a voz e a tela, e a LiveKit não aceita duas conexões com a mesma
/// identidade (ADR 0017).
pub const SCREEN_SUFFIX: &str = ":screen";

/// O começo do nome da sala do Testar conexão (v0.6, decisão 20): `teste:{user_id}`. Nenhum canal
/// tem `:` no id, e o webhook ignora essas salas (ninguém vê a pessoa "entrar" nelas).
pub const TEST_ROOM_PREFIX: &str = "teste:";

/// A sala do Testar conexão de `user_id`.
pub fn test_room(user_id: &str) -> String {
    format!("{TEST_ROOM_PREFIX}{user_id}")
}

/// A identidade da tela de `user_id`.
pub fn screen_identity(user_id: &str) -> String {
    format!("{user_id}{SCREEN_SUFFIX}")
}

/// Da resposta do LiveKit para o que a lista usa, na ordem em que entraram.
/// A `:screen` de alguém não vira participante: só marca o dono como transmitindo. Sem o dono na
/// sala (ele saiu e a tela ainda não), ela fica de fora.
pub fn room_participants(mut infos: Vec<ParticipantInfo>) -> Vec<RoomParticipant> {
    infos.sort_by_key(|info| (info.joined_at, info.joined_at_ms));
    let shares_screen = |info: &ParticipantInfo| {
        info.tracks
            .iter()
            .any(|track| track.source() == TrackSource::ScreenShare)
    };
    let screens: Vec<&str> = infos
        .iter()
        .filter(|info| shares_screen(info))
        .filter_map(|info| info.identity.strip_suffix(SCREEN_SUFFIX))
        .collect();
    infos
        .iter()
        .filter(|info| !info.identity.ends_with(SCREEN_SUFFIX))
        .map(|info| RoomParticipant {
            screen_sharing: shares_screen(info) || screens.contains(&info.identity.as_str()),
            identity: info.identity.clone(),
        })
        .collect()
}

/// Junta a lista do LiveKit com o banco: o nick e o nome visível saem do membro
/// cujo id é a identidade. Uma identidade que não é de ninguém (o app antigo
/// entra como `idiot-<uuid>`) fica de fora. Quem foi removido e continua
/// conectado aparece: a lista mostra quem está ouvindo de verdade.
pub async fn join_participants(
    db: &SqlitePool,
    room: Vec<RoomParticipant>,
) -> Result<Vec<ParticipantView>, ApiError> {
    if room.is_empty() {
        return Ok(Vec::new());
    }
    let members: HashMap<String, User> = users::list(db)
        .await?
        .into_iter()
        .map(|user| (user.id.clone(), user))
        .collect();
    Ok(room
        .into_iter()
        .filter_map(|participant| {
            let user = members.get(&participant.identity)?;
            Some(ParticipantView {
                user_id: user.id.clone(),
                nick: user.nick.clone(),
                display_name: user.display_name.clone(),
                screen_sharing: participant.screen_sharing,
            })
        })
        .collect())
}

/// Um cliente do LiveKit para a API inteira, criado na primeira consulta: ele
/// guarda as conexões abertas entre uma chamada e outra.
static ROOM_CLIENT: OnceLock<RoomClient> = OnceLock::new();

/// Tempo máximo de uma consulta ao LiveKit. O app pergunta a cada 5 segundos.
const LIVEKIT_TIMEOUT: Duration = Duration::from_secs(5);

fn room_client() -> Result<&'static RoomClient, ApiError> {
    if let Some(client) = ROOM_CLIENT.get() {
        return Ok(client);
    }
    let (api_key, api_secret, url) = livekit_env().map_err(ApiError::Config)?;
    let client =
        RoomClient::with_api_key(&url, &api_key, &api_secret).with_request_timeout(LIVEKIT_TIMEOUT);
    Ok(ROOM_CLIENT.get_or_init(|| client))
}

/// Pergunta ao LiveKit quem está na sala `channel_id`.
pub async fn list_room(channel_id: &str) -> Result<Vec<RoomParticipant>, ApiError> {
    match room_client()?.list_participants(channel_id).await {
        Ok(infos) => Ok(room_participants(infos)),
        // Sala que não existe (ainda não criada, ou já fechada): ninguém nela.
        Err(error) if is_not_found(&error) => Ok(Vec::new()),
        Err(error) => Err(ApiError::LiveKit(error.to_string())),
    }
}

/// O "não existe" do LiveKit: a sala, ou a pessoa dentro dela.
fn is_not_found(error: &ServiceError) -> bool {
    matches!(
        error,
        ServiceError::Twirp(ServerError::Twirp(error)) if error.code == ServerErrorCode::NOT_FOUND
    )
}

/// O que tirar alguém da sala precisa do LiveKit: o `RoomClient` de verdade, ou
/// um de mentira nos testes.
pub(crate) trait VoiceRooms {
    /// O nome de toda sala aberta agora.
    async fn names(&self) -> Result<Vec<String>, ServiceError>;
    /// O `RemoveParticipant`: derruba a conexão de `identity` na sala `room`.
    async fn remove(&self, room: &str, identity: &str) -> Result<(), ServiceError>;
}

impl VoiceRooms for RoomClient {
    async fn names(&self) -> Result<Vec<String>, ServiceError> {
        let rooms = self.list_rooms(Vec::new()).await?;
        Ok(rooms.into_iter().map(|room| room.name).collect())
    }

    async fn remove(&self, room: &str, identity: &str) -> Result<(), ServiceError> {
        self.remove_participant(room, identity).await
    }
}

/// Tira `identity` (e a tela dela, `{identity}:screen`) de toda sala em que estiver e devolve
/// quantas conexões caíram. Quem não está numa sala (o "não existe" do LiveKit) não é erro. O
/// LiveKit também recusa o token antigo dessa pessoa numa nova entrada; o novo, a API já não dá.
pub(crate) async fn kick_from(
    rooms: &impl VoiceRooms,
    identity: &str,
) -> Result<usize, ServiceError> {
    let screen = screen_identity(identity);
    let mut removed = 0;
    for room in rooms.names().await? {
        for who in [identity, screen.as_str()] {
            match rooms.remove(&room, who).await {
                Ok(()) => removed += 1,
                Err(error) if is_not_found(&error) => {}
                Err(error) => return Err(error),
            }
        }
    }
    Ok(removed)
}

/// Tira da sala, na hora, quem acabou de ser removido ou de ter o computador
/// desvinculado: sem isso, a pessoa continuaria ouvindo e falando até a próxima
/// chamada à API. Roda à parte, para a resposta não esperar o LiveKit (até 5
/// segundos por consulta). Se falhar, a remoção continua valendo e o erro vai
/// para o log.
pub fn kick_in_background(identity: String) {
    tokio::spawn(async move {
        let result = match room_client() {
            Ok(client) => kick_from(client, &identity)
                .await
                .map_err(|error| error.to_string()),
            Err(ApiError::Config(message)) => Err(message),
            Err(error) => Err(error.to_string()),
        };
        if let Err(error) = result {
            eprintln!("livekit: não deu para tirar {identity} da sala: {error}");
        }
    });
}

/// Tira `identity` e a tela dela da sala `room`, à parte, como o
/// [`kick_in_background`], mas só nessa sala (ADR 0026: desconectar e mover).
/// Quem já saiu não é erro, e sem as chaves do LiveKit não há o que tirar.
pub fn remove_from_room_in_background(room: String, identity: String) {
    tokio::spawn(async move {
        let client = match room_client() {
            Ok(client) => client,
            Err(ApiError::Config(_)) => return,
            Err(error) => {
                eprintln!("livekit: não deu para tirar {identity} da sala {room}: {error}");
                return;
            }
        };
        let screen = screen_identity(&identity);
        for who in [identity.as_str(), screen.as_str()] {
            match client.remove_participant(&room, who).await {
                Ok(()) => {}
                Err(error) if is_not_found(&error) => {}
                Err(error) => {
                    eprintln!("livekit: não deu para tirar {who} da sala {room}: {error}");
                }
            }
        }
    });
}

/// A sala do LiveKit em que `user_id` está pela voz, perguntando a todas. É o
/// plano B do [`crate::realtime::Hub::room_of`], que só sabe das salas que
/// mudaram desde que a API subiu. Sem as chaves do LiveKit, nenhuma.
pub async fn find_room_of(user_id: &str) -> Result<Option<String>, ApiError> {
    let client = match room_client() {
        Ok(client) => client,
        Err(ApiError::Config(_)) => return Ok(None),
        Err(error) => return Err(error),
    };
    let names = VoiceRooms::names(client)
        .await
        .map_err(|error| ApiError::LiveKit(error.to_string()))?;
    for room in names {
        if list_room(&room)
            .await?
            .iter()
            .any(|p| p.identity == user_id)
        {
            return Ok(Some(room));
        }
    }
    Ok(None)
}

pub(crate) fn livekit_env() -> Result<(String, String, String), String> {
    let get = |name: &str| env::var(name).map_err(|error| format!("{name}: {error}"));
    Ok((
        get("LIVEKIT_API_KEY")?,
        get("LIVEKIT_API_SECRET")?,
        get("LIVEKIT_URL")?,
    ))
}

/// Apaga a sala `room` no LiveKit, o que derruba quem ainda estiver nela. É o
/// fim da ligação privada (ADR 0023): quando um dos dois sai, o outro não fica
/// sozinho na sala. Roda à parte, como o [`kick_in_background`]; sala que já
/// não existe não é erro, e sem as chaves do LiveKit não há o que apagar.
pub fn delete_room_in_background(room: String) {
    tokio::spawn(async move {
        let client = match room_client() {
            Ok(client) => client,
            Err(ApiError::Config(_)) => return,
            Err(error) => {
                eprintln!("livekit: não deu para apagar a sala {room}: {error}");
                return;
            }
        };
        match client.delete_room(&room).await {
            Ok(()) => {}
            Err(error) if is_not_found(&error) => {}
            Err(error) => eprintln!("livekit: não deu para apagar a sala {room}: {error}"),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tela_de_alguem_so_marca_o_dono() {
        let room = room_participants(vec![
            participant("kid", 10, &[TrackSource::Microphone]),
            participant("juju", 11, &[TrackSource::Microphone]),
            participant(
                "kid:screen",
                12,
                &[TrackSource::ScreenShare, TrackSource::ScreenShareAudio],
            ),
            // A tela de quem já saiu da voz fica de fora.
            participant("marcao:screen", 13, &[TrackSource::ScreenShare]),
            // Entrou, mas ainda não publicou: o dono não está transmitindo.
            participant("juju:screen", 14, &[]),
        ]);
        let sharing: Vec<(&str, bool)> = room
            .iter()
            .map(|p| (p.identity.as_str(), p.screen_sharing))
            .collect();
        assert_eq!(sharing, [("kid", true), ("juju", false)]);
    }

    fn participant(identity: &str, joined_at: i64, sources: &[TrackSource]) -> ParticipantInfo {
        ParticipantInfo {
            identity: identity.to_owned(),
            joined_at,
            tracks: sources
                .iter()
                .map(|source| livekit_protocol::TrackInfo {
                    source: *source as i32,
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        }
    }

    #[test]
    fn transmitindo_e_quem_tem_trilha_de_tela() {
        let room = room_participants(vec![
            participant("so-voz", 10, &[TrackSource::Microphone]),
            participant(
                "tela",
                11,
                &[TrackSource::Microphone, TrackSource::ScreenShare],
            ),
            // O áudio da tela sem a imagem não conta.
            participant("audio-da-tela", 12, &[TrackSource::ScreenShareAudio]),
            participant("camera", 13, &[TrackSource::Camera]),
            participant("calado", 14, &[]),
        ]);
        let sharing: Vec<(&str, bool)> = room
            .iter()
            .map(|p| (p.identity.as_str(), p.screen_sharing))
            .collect();
        assert_eq!(
            sharing,
            [
                ("so-voz", false),
                ("tela", true),
                ("audio-da-tela", false),
                ("camera", false),
                ("calado", false),
            ]
        );
    }

    #[test]
    fn a_lista_vem_na_ordem_de_entrada() {
        let room = room_participants(vec![
            participant("terceiro", 30, &[]),
            participant("primeiro", 10, &[]),
            participant("segundo", 20, &[]),
        ]);
        let order: Vec<&str> = room.iter().map(|p| p.identity.as_str()).collect();
        assert_eq!(order, ["primeiro", "segundo", "terceiro"]);
    }

    /// Um LiveKit de mentira: as salas, quem está em cada uma e um erro opcional.
    struct FakeRooms {
        rooms: Vec<(&'static str, Vec<&'static str>)>,
        fail_on: Option<&'static str>,
        removed: std::sync::Mutex<Vec<String>>,
    }

    fn twirp(code: &str) -> ServiceError {
        ServiceError::Twirp(ServerError::Twirp(ServerErrorCode {
            code: code.to_owned(),
            msg: String::new(),
            meta: HashMap::new(),
        }))
    }

    impl VoiceRooms for FakeRooms {
        async fn names(&self) -> Result<Vec<String>, ServiceError> {
            Ok(self
                .rooms
                .iter()
                .map(|(name, _)| name.to_string())
                .collect())
        }

        async fn remove(&self, room: &str, identity: &str) -> Result<(), ServiceError> {
            if self.fail_on == Some(room) {
                return Err(twirp(ServerErrorCode::UNAVAILABLE));
            }
            let (_, people) = self.rooms.iter().find(|(name, _)| *name == room).unwrap();
            if !people.contains(&identity) {
                return Err(twirp(ServerErrorCode::NOT_FOUND));
            }
            self.removed
                .lock()
                .unwrap()
                .push(format!("{room}/{identity}"));
            Ok(())
        }
    }

    fn fake(rooms: Vec<(&'static str, Vec<&'static str>)>) -> FakeRooms {
        FakeRooms {
            rooms,
            fail_on: None,
            removed: Default::default(),
        }
    }

    #[tokio::test]
    async fn tirar_da_sala_passa_por_todas_e_ignora_onde_nao_esta() {
        let rooms = fake(vec![
            ("sala", vec!["kid", "juju", "kid:screen"]),
            ("papo", vec!["kid"]),
            ("afk", vec!["marcao"]),
        ]);
        assert_eq!(kick_from(&rooms, "kid").await.unwrap(), 3);
        assert_eq!(
            *rooms.removed.lock().unwrap(),
            ["sala/kid", "sala/kid:screen", "papo/kid"]
        );

        // Fora de todas as salas, ou sem sala nenhuma: nada a fazer, sem erro.
        assert_eq!(kick_from(&rooms, "ninguem").await.unwrap(), 0);
        assert_eq!(kick_from(&fake(vec![]), "kid").await.unwrap(), 0);
    }

    #[tokio::test]
    async fn outro_erro_do_livekit_volta_para_quem_chamou() {
        let mut rooms = fake(vec![("sala", vec!["kid"])]);
        rooms.fail_on = Some("sala");
        let error = kick_from(&rooms, "kid").await.unwrap_err();
        assert!(!is_not_found(&error));
        assert!(is_not_found(&twirp(ServerErrorCode::NOT_FOUND)));
    }
}
