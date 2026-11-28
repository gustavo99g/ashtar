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

use livekit_api::services::room::{RoomClient, UpdateParticipantOptions};
use livekit_api::services::{ServerError, ServerErrorCode, ServiceError};
use livekit_protocol::{ParticipantInfo, ParticipantPermission, TrackSource};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;

use crate::error::ApiError;
use crate::identity::{User, users};
use crate::moderation::{self, Imposed};

/// Uma pessoa na sala, com o nick e o nome visível do banco.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct ParticipantView {
    pub user_id: String,
    pub nick: String,
    pub display_name: Option<String>,
    /// Se está transmitindo a tela (o selo TRANSMITINDO).
    pub screen_sharing: bool,
    /// O id do arquivo da foto de perfil, ou `null` (ADR 0031).
    #[ts(optional = nullable)]
    pub avatar: Option<String>,
    /// Sem microfone (mutado ou sem trilha), pelo que o app da pessoa contou ([`VoiceFlags`]).
    pub mic_off: bool,
    /// Com o áudio desligado (deafen).
    pub deafened: bool,
    /// Com a câmera ligada.
    pub camera: bool,
    /// O que a pessoa está transmitindo, pelo que o app dela contou ([`ShareInfo`]). Só enquanto
    /// transmite.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional = nullable)]
    pub share: Option<ShareInfo>,
    /// As telas dos aparelhos de transmissão dela na sala (ADR 0038). A lista mostra cada uma como
    /// uma entrada à parte, logo depois da pessoa; não marcam a pessoa como transmitindo.
    pub devices: Vec<DeviceShareView>,
    /// Silenciada pela moderação (ADR 0034): o microfone vermelho com o escudo.
    pub server_muted: bool,
    /// Com o áudio desligado pela moderação.
    pub server_deafened: bool,
    /// Sem tocar sons pela moderação (ADR 0037): o botão Sons dela fica apagado.
    pub sounds_blocked: bool,
}

/// A tela de um aparelho de transmissão na sala (ADR 0038), na entrada do dono.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct DeviceShareView {
    /// A identidade da conexão (`{dono}:screen-{aparelho}`): é a chave da transmissão no app.
    pub identity: String,
    /// O nome do aparelho ("Odin 3").
    pub name: String,
}

/// A transmissão de alguém, para o cartão de Assistir de quem está fora da sala (v0.7): a fonte,
/// o preset, desde quando e quantos assistem. Quem está fora não recebe a imagem nem os dados da
/// LiveKit, então é o app de quem transmite que conta.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct ShareInfo {
    /// O nome da fonte: a tela ("Tela 1") ou o título da janela.
    pub title: String,
    /// Se é uma janela (`true`) ou a tela inteira.
    pub window: bool,
    /// A chave do preset (`720p60`, `1080p60`, `1080p30`).
    pub quality: String,
    /// Quando começou, em milissegundos desde 1970.
    #[ts(type = "number")]
    pub started_at: i64,
    /// Quantos estão assistindo agora.
    pub viewers: u32,
}

/// O tamanho máximo do título da fonte e da chave do preset; o resto é cortado.
const SHARE_TITLE_MAX: usize = 120;
const SHARE_QUALITY_MAX: usize = 16;

impl ShareInfo {
    /// Corta o que veio do app nos tamanhos máximos.
    pub fn clamp(mut self) -> Self {
        self.title = self.title.trim().chars().take(SHARE_TITLE_MAX).collect();
        self.quality = self.quality.chars().take(SHARE_QUALITY_MAX).collect();
        self
    }
}

/// O que o app de cada um conta do próprio estado na sala (v0.7): o LiveKit não avisa a API de
/// quem muta, e o áudio desligado nem passa por ele. Com isso, quem está fora da sala vê os ícones
/// também. Enquanto existe, vale mais que o LiveKit, inclusive para a tela: é o app que sabe
/// primeiro.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct VoiceFlags {
    pub mic_off: bool,
    pub deafened: bool,
    pub camera: bool,
    pub sharing: bool,
    /// O que está transmitindo; vale só com `sharing`.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub share: Option<ShareInfo>,
}

impl VoiceFlags {
    /// `view` com o estado que o app contou.
    pub fn apply(&self, view: &mut ParticipantView) {
        view.mic_off = self.mic_off;
        view.deafened = self.deafened;
        view.camera = self.camera;
        view.screen_sharing = self.sharing;
        view.share = if self.sharing {
            self.share.clone()
        } else {
            None
        };
    }
}

/// Quem o LiveKit diz que está na sala: a identidade do token (o id do membro)
/// e se tem uma trilha de tela publicada.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RoomParticipant {
    pub identity: String,
    /// Transmite pelo computador (a `:screen`) ou pela própria conexão.
    pub screen_sharing: bool,
    /// As telas dos aparelhos dela que estão no ar (ADR 0038).
    pub devices: Vec<DeviceShareView>,
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

/// A identidade da tela que o aparelho de transmissão `device_id` de `user_id` publica (ADR 0038):
/// `{user_id}:screen-{device_id}`. Fica ao lado da `{user_id}:screen` do computador, então dá para
/// transmitir dos dois ao mesmo tempo.
pub fn device_screen_identity(user_id: &str, device_id: &str) -> String {
    format!("{user_id}{SCREEN_SUFFIX}-{device_id}")
}

/// De quem é a identidade de uma tela: `{dono}:screen` (o computador) ou `{dono}:screen-{aparelho}`
/// (ADR 0038). `None` para o que não é tela (a voz, ou outra coisa). Nenhum id de membro tem `:`,
/// então o dono é o que vem antes do primeiro.
pub fn screen_owner(identity: &str) -> Option<&str> {
    let (owner, rest) = identity.split_once(':')?;
    let is_screen = rest == &SCREEN_SUFFIX[1..]
        || rest
            .strip_prefix(&SCREEN_SUFFIX[1..])
            .and_then(|tail| tail.strip_prefix('-'))
            .is_some_and(|device| !device.is_empty());
    (is_screen && !owner.is_empty()).then_some(owner)
}

/// Se a identidade é a de uma tela, do computador ou de um aparelho.
pub fn is_screen_identity(identity: &str) -> bool {
    screen_owner(identity).is_some()
}

/// Se a identidade é a tela de um aparelho de transmissão (`{dono}:screen-{aparelho}`).
pub fn is_device_screen_identity(identity: &str) -> bool {
    is_screen_identity(identity) && !identity.ends_with(SCREEN_SUFFIX)
}

/// Uma conexão de tela numa sala: de quem é e se está publicando a tela agora.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScreenConnection {
    pub identity: String,
    pub owner: String,
    pub publishing: bool,
}

/// As conexões de tela da resposta do LiveKit, publicando ou não.
pub fn screen_connections(infos: &[ParticipantInfo]) -> Vec<ScreenConnection> {
    infos
        .iter()
        .filter_map(|info| {
            let owner = screen_owner(&info.identity)?;
            Some(ScreenConnection {
                identity: info.identity.clone(),
                owner: owner.to_owned(),
                publishing: info
                    .tracks
                    .iter()
                    .any(|track| track.source() == TrackSource::ScreenShare),
            })
        })
        .collect()
}

/// As conexões de tela da sala `channel_id` agora. Sala que não existe: nenhuma.
pub async fn list_screens(channel_id: &str) -> Result<Vec<ScreenConnection>, ApiError> {
    match room_client()?.list_participants(channel_id).await {
        Ok(infos) => Ok(screen_connections(&infos)),
        Err(error) if is_not_found(&error) => Ok(Vec::new()),
        Err(error) => Err(ApiError::LiveKit(error.to_string())),
    }
}

/// Derruba, na sala `room`, as telas dos aparelhos de `user_id` (ADR 0038). É o "segue o dono":
/// quando a voz dele sai da sala, o aparelho cai junto. Devolve quantas caíram.
pub async fn drop_device_screens(
    client: &RoomClient,
    room: &str,
    user_id: &str,
) -> Result<usize, ServiceError> {
    let infos = match client.list_participants(room).await {
        Ok(infos) => infos,
        Err(error) if is_not_found(&error) => return Ok(0),
        Err(error) => return Err(error),
    };
    let mut dropped = 0;
    for screen in screen_connections(&infos)
        .into_iter()
        .filter(|screen| screen.owner == user_id && is_device_screen_identity(&screen.identity))
    {
        match client.remove_participant(room, &screen.identity).await {
            Ok(()) => dropped += 1,
            Err(error) if is_not_found(&error) => {}
            Err(error) => return Err(error),
        }
    }
    Ok(dropped)
}

/// O [`drop_device_screens`] à parte: a resposta (ou o webhook) não espera o LiveKit.
pub fn drop_device_screens_in_background(room: String, user_id: String) {
    with_client_in_background(
        format!("derrubar os aparelhos de {user_id} na sala {room}"),
        move |client| async move {
            drop_device_screens(client, &room, &user_id)
                .await
                .map(|_| ())
        },
    );
}

/// Da resposta do LiveKit para o que a lista usa, na ordem em que entraram.
/// A `:screen` de alguém não vira participante: só marca o dono como transmitindo. A
/// `:screen-{aparelho}` (ADR 0038) também não, mas vai na entrada do dono como um aparelho, que a
/// lista mostra à parte. Sem o dono na sala (ele saiu e a tela ainda não), a tela fica de fora.
pub fn room_participants(mut infos: Vec<ParticipantInfo>) -> Vec<RoomParticipant> {
    infos.sort_by_key(|info| (info.joined_at, info.joined_at_ms));
    let shares_screen = |info: &ParticipantInfo| {
        info.tracks
            .iter()
            .any(|track| track.source() == TrackSource::ScreenShare)
    };
    let publishing: Vec<&ParticipantInfo> = infos
        .iter()
        .filter(|info| is_screen_identity(&info.identity) && shares_screen(info))
        .collect();
    infos
        .iter()
        .filter(|info| !is_screen_identity(&info.identity))
        .map(|info| {
            let own = |screen: &&&ParticipantInfo| {
                screen_owner(&screen.identity) == Some(info.identity.as_str())
            };
            let pc = publishing
                .iter()
                .filter(own)
                .any(|screen| !is_device_screen_identity(&screen.identity));
            RoomParticipant {
                screen_sharing: shares_screen(info) || pc,
                identity: info.identity.clone(),
                devices: publishing
                    .iter()
                    .filter(own)
                    .filter(|screen| is_device_screen_identity(&screen.identity))
                    .map(|screen| DeviceShareView {
                        identity: screen.identity.clone(),
                        name: device_name(&screen.metadata),
                    })
                    .collect(),
            }
        })
        .collect()
}

/// O nome do aparelho, dos metadados que a API pôs no token (`"source": "Odin 3"`).
fn device_name(metadata: &str) -> String {
    serde_json::from_str::<serde_json::Value>(metadata)
        .ok()
        .and_then(|value| value.get("source")?.as_str().map(str::to_owned))
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "Aparelho".to_owned())
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
    let moderated = moderation::all(db).await?;
    Ok(room
        .into_iter()
        .filter_map(|participant| {
            let user = members.get(&participant.identity)?;
            let imposed = moderated.get(&user.id).copied().unwrap_or_default();
            Some(ParticipantView {
                server_muted: imposed.mic_muted,
                server_deafened: imposed.deafened,
                sounds_blocked: imposed.sounds_blocked,
                user_id: user.id.clone(),
                nick: user.nick.clone(),
                display_name: user.display_name.clone(),
                screen_sharing: participant.screen_sharing,
                devices: participant.devices,
                avatar: user.avatar_id.clone(),
                ..ParticipantView::default()
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

/// Quanto o LiveKit leva para responder uma consulta pequena (a lista de uma sala que não existe),
/// para o estado do servidor no Painel. `Err` se ele não responde.
pub async fn livekit_latency() -> Result<Duration, ApiError> {
    let started = std::time::Instant::now();
    room_client()?
        .list_rooms(vec!["ashtar-status".into()])
        .await
        .map_err(|error| ApiError::LiveKit(error.to_string()))?;
    Ok(started.elapsed())
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
    /// O `GetParticipant`: a conexão de `identity` na sala `room`, com as trilhas.
    async fn participant(
        &self,
        room: &str,
        identity: &str,
    ) -> Result<ParticipantInfo, ServiceError>;
    /// O `UpdateParticipant` só com a permissão: o que `identity` pode publicar e receber.
    async fn set_permission(
        &self,
        room: &str,
        identity: &str,
        permission: ParticipantPermission,
    ) -> Result<(), ServiceError>;
    /// O `MutePublishedTrack`: muta a trilha `sid` de `identity`.
    async fn mute_track(&self, room: &str, identity: &str, sid: &str) -> Result<(), ServiceError>;
}

impl VoiceRooms for RoomClient {
    async fn names(&self) -> Result<Vec<String>, ServiceError> {
        let rooms = self.list_rooms(Vec::new()).await?;
        Ok(rooms.into_iter().map(|room| room.name).collect())
    }

    async fn remove(&self, room: &str, identity: &str) -> Result<(), ServiceError> {
        self.remove_participant(room, identity).await
    }

    async fn participant(
        &self,
        room: &str,
        identity: &str,
    ) -> Result<ParticipantInfo, ServiceError> {
        self.get_participant(room, identity).await
    }

    async fn set_permission(
        &self,
        room: &str,
        identity: &str,
        permission: ParticipantPermission,
    ) -> Result<(), ServiceError> {
        self.update_participant(
            room,
            identity,
            UpdateParticipantOptions {
                permission: Some(permission),
                ..Default::default()
            },
        )
        .await
        .map(|_| ())
    }

    async fn mute_track(&self, room: &str, identity: &str, sid: &str) -> Result<(), ServiceError> {
        self.mute_published_track(room, identity, sid, true)
            .await
            .map(|_| ())
    }
}

/// Aplica na conexão de voz de `identity` na sala `room` o que a moderação impôs (ADR 0034): o
/// LiveKit para o microfone de quem foi silenciado e corta o áudio de quem ficou surdo, sem
/// depender do app. Quem já saiu da sala não é erro: o token da próxima entrada já sai travado.
pub(crate) async fn restrict(
    rooms: &impl VoiceRooms,
    room: &str,
    identity: &str,
    imposed: Imposed,
) -> Result<(), ServiceError> {
    match rooms
        .set_permission(room, identity, imposed.permission())
        .await
    {
        Err(error) if is_not_found(&error) => Ok(()),
        result => result,
    }
}

/// Muta a câmera de `identity` na sala `room` e devolve quantas trilhas mutou. O app da pessoa
/// recebe o `voice.moderated` e desliga a câmera de verdade; isto é a garantia.
pub(crate) async fn mute_camera(
    rooms: &impl VoiceRooms,
    room: &str,
    identity: &str,
) -> Result<usize, ServiceError> {
    let info = match rooms.participant(room, identity).await {
        Ok(info) => info,
        Err(error) if is_not_found(&error) => return Ok(0),
        Err(error) => return Err(error),
    };
    let mut muted = 0;
    for track in info
        .tracks
        .iter()
        .filter(|track| track.source() == TrackSource::Camera && !track.muted)
    {
        rooms.mute_track(room, identity, &track.sid).await?;
        muted += 1;
    }
    Ok(muted)
}

/// Roda `job` com o `RoomClient` à parte, como o [`kick_in_background`]: a resposta não espera o
/// LiveKit. Sem as chaves do LiveKit, não há o que fazer; um erro vai para o log com `what`.
fn with_client_in_background<F, Fut>(what: String, job: F)
where
    F: FnOnce(&'static RoomClient) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = Result<(), ServiceError>> + Send,
{
    tokio::spawn(async move {
        let client = match room_client() {
            Ok(client) => client,
            Err(ApiError::Config(_)) => return,
            Err(error) => {
                eprintln!("livekit: não deu para {what}: {error}");
                return;
            }
        };
        if let Err(error) = job(client).await {
            eprintln!("livekit: não deu para {what}: {error}");
        }
    });
}

/// O [`restrict`] com o `RoomClient`, esperando o LiveKit (até 5 segundos). Um erro vai para o log:
/// o banco já vale, e a próxima entrada sai travada pelo token.
pub async fn restrict_now(room: &str, identity: &str, imposed: Imposed) {
    let client = match room_client() {
        Ok(client) => client,
        Err(ApiError::Config(_)) => return,
        Err(error) => {
            eprintln!(
                "livekit: não deu para aplicar a moderação de {identity} na sala {room}: {error}"
            );
            return;
        }
    };
    if let Err(error) = restrict(client, room, identity, imposed).await {
        eprintln!(
            "livekit: não deu para aplicar a moderação de {identity} na sala {room}: {error}"
        );
    }
}

/// O [`mute_camera`] à parte.
pub fn mute_camera_in_background(room: String, identity: String) {
    with_client_in_background(
        format!("desligar a câmera de {identity} na sala {room}"),
        move |client| async move { mute_camera(client, &room, &identity).await.map(|_| ()) },
    );
}

/// Quanto o app tem para parar a transmissão sozinho antes de a API derrubar a tela.
const STOP_SHARE_GRACE: Duration = Duration::from_secs(2);

/// Derruba só as transmissões de tela de `user_id` na sala `room`: a do computador (`{id}:screen`)
/// e as dos aparelhos dele (`{id}:screen-{aparelho}`, ADR 0038).
pub fn stop_share_in_background(room: String, user_id: String) {
    let screen = screen_identity(&user_id);
    with_client_in_background(
        format!("encerrar a transmissão de {user_id} na sala {room}"),
        move |client| async move {
            // O app da pessoa recebe o `voice.moderated` e para sozinho; a queda aqui é a garantia,
            // e esperar um pouco evita que ele a veja antes e tente voltar.
            tokio::time::sleep(STOP_SHARE_GRACE).await;
            match client.remove_participant(&room, &screen).await {
                Err(error) if is_not_found(&error) => {}
                result => result?,
            }
            // As telas dos aparelhos dele também são transmissões dele (ADR 0038).
            drop_device_screens(client, &room, &user_id)
                .await
                .map(|_| ())
        },
    );
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
            Ok(client) => {
                let result = kick_from(client, &identity)
                    .await
                    .map_err(|error| error.to_string());
                // Os aparelhos de transmissão dele (ADR 0038), em toda sala.
                if let Ok(rooms) = client.names().await {
                    for room in rooms {
                        if let Err(error) = drop_device_screens(client, &room, &identity).await {
                            eprintln!(
                                "livekit: não deu para tirar os aparelhos de {identity}: {error}"
                            );
                        }
                    }
                }
                result
            }
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
        if let Err(error) = drop_device_screens(client, &room, &identity).await {
            eprintln!(
                "livekit: não deu para tirar os aparelhos de {identity} da sala {room}: {error}"
            );
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
    fn o_dono_da_tela_do_computador_e_do_aparelho() {
        assert_eq!(screen_owner("kid:screen"), Some("kid"));
        assert_eq!(screen_owner("kid:screen-0a1b2c3d4e5f"), Some("kid"));
        assert_eq!(screen_owner("kid"), None);
        assert_eq!(screen_owner("kid:screen-"), None);
        assert_eq!(screen_owner("kid:screenx"), None);
        assert_eq!(screen_owner(":screen"), None);
        assert_eq!(screen_owner("teste:kid"), None);
        assert!(is_device_screen_identity("kid:screen-odin"));
        assert!(!is_device_screen_identity("kid:screen"));
        assert!(!is_device_screen_identity("kid"));
        assert_eq!(device_screen_identity("kid", "odin"), "kid:screen-odin");
    }

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

    #[test]
    fn a_tela_do_aparelho_vai_a_parte_e_conta_como_outra_conexao() {
        let mut odin = participant("juju:screen-odin", 14, &[TrackSource::ScreenShare]);
        odin.metadata = r#"{"screenOf":"juju","nick":"juju","source":"Odin 3"}"#.into();
        let infos = vec![
            participant("kid", 10, &[TrackSource::Microphone]),
            participant("juju", 11, &[TrackSource::Microphone]),
            participant("kid:screen", 12, &[TrackSource::ScreenShare]),
            participant("kid:screen-odin", 13, &[TrackSource::ScreenShare]),
            odin,
            // Entrou, mas ainda não publicou: não aparece.
            participant("kid:screen-tab", 15, &[]),
        ];
        let room = room_participants(infos.clone());
        let sharing: Vec<(&str, bool)> = room
            .iter()
            .map(|p| (p.identity.as_str(), p.screen_sharing))
            .collect();
        // A Juju só transmite pelo aparelho: ela mesma não está transmitindo.
        assert_eq!(sharing, [("kid", true), ("juju", false)]);
        let device = |identity: &str, name: &str| DeviceShareView {
            identity: identity.into(),
            name: name.into(),
        };
        assert_eq!(room[0].devices, [device("kid:screen-odin", "Aparelho")]);
        assert_eq!(room[1].devices, [device("juju:screen-odin", "Odin 3")]);
        let screens: Vec<(String, String)> = screen_connections(&infos)
            .into_iter()
            .filter(|screen| screen.publishing)
            .map(|screen| (screen.identity, screen.owner))
            .collect();
        assert_eq!(
            screens,
            [
                ("kid:screen".into(), "kid".into()),
                ("kid:screen-odin".into(), "kid".into()),
                ("juju:screen-odin".into(), "juju".into()),
            ]
        );
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

        async fn participant(
            &self,
            room: &str,
            identity: &str,
        ) -> Result<ParticipantInfo, ServiceError> {
            let (_, people) = self.rooms.iter().find(|(name, _)| *name == room).unwrap();
            if !people.contains(&identity) {
                return Err(twirp(ServerErrorCode::NOT_FOUND));
            }
            let mut info = participant(identity, 0, &[TrackSource::Microphone]);
            // A câmera ligada e uma já mutada: só a ligada é mutada de novo.
            for (sid, muted) in [("TR_cam", false), ("TR_cam_velha", true)] {
                info.tracks.push(livekit_protocol::TrackInfo {
                    sid: sid.into(),
                    source: TrackSource::Camera as i32,
                    muted,
                    ..Default::default()
                });
            }
            Ok(info)
        }

        async fn set_permission(
            &self,
            room: &str,
            identity: &str,
            permission: ParticipantPermission,
        ) -> Result<(), ServiceError> {
            let (_, people) = self.rooms.iter().find(|(name, _)| *name == room).unwrap();
            if !people.contains(&identity) {
                return Err(twirp(ServerErrorCode::NOT_FOUND));
            }
            self.removed.lock().unwrap().push(format!(
                "{room}/{identity} subscribe={} sources={}",
                permission.can_subscribe,
                permission.can_publish_sources.len()
            ));
            Ok(())
        }

        async fn mute_track(
            &self,
            room: &str,
            identity: &str,
            sid: &str,
        ) -> Result<(), ServiceError> {
            self.removed
                .lock()
                .unwrap()
                .push(format!("{room}/{identity} mute {sid}"));
            Ok(())
        }
    }

    #[tokio::test]
    async fn a_moderacao_vai_para_o_livekit() {
        let rooms = fake(vec![("sala", vec!["kid", "juju"])]);
        let muted = Imposed {
            mic_muted: true,
            ..Imposed::default()
        };
        restrict(&rooms, "sala", "juju", muted).await.unwrap();
        // Quem já saiu da sala não é erro: o próximo token sai travado.
        restrict(&rooms, "sala", "marcao", muted).await.unwrap();
        assert_eq!(mute_camera(&rooms, "sala", "juju").await.unwrap(), 1);
        assert_eq!(mute_camera(&rooms, "sala", "marcao").await.unwrap(), 0);
        assert_eq!(
            *rooms.removed.lock().unwrap(),
            [
                "sala/juju subscribe=true sources=3",
                "sala/juju mute TR_cam"
            ]
        );
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
