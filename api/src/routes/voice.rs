//! Rotas de voz: o token para entrar na sala e a lista de quem já está nela.
//! Também tira da sala quem foi removido ou teve o computador desvinculado
//! ([`kick_in_background`], chamado pelas rotas de membros).

use std::collections::HashMap;
use std::env;
use std::sync::OnceLock;
use std::time::Duration;

use axum::Json;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Query, State};
use livekit_api::access_token::{AccessToken, VideoGrants};
use livekit_api::services::room::RoomClient;
use livekit_api::services::{ServerError, ServerErrorCode, ServiceError};
use livekit_protocol::{ParticipantInfo, TrackSource};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::SqlitePool;
use ts_rs::TS;

use super::auth::CurrentUser;
use super::extract::ApiJson;
use crate::AppState;
use crate::error::ApiError;
use crate::identity::{User, users};

#[derive(Debug, Deserialize)]
pub struct JoinVoiceRequest {
    pub channel_id: String,
    pub user_id: String,
    pub display_name: String,
}

/// A resposta do `voice/join` e do `voice/token`.
#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct JoinVoiceResponse {
    pub token: String,
    pub url: String,
}

/// Rota de hoje: identidade e nome vêm do app. Continua até a parte visual.
pub async fn join_voice(
    Json(request): Json<JoinVoiceRequest>,
) -> Result<Json<JoinVoiceResponse>, String> {
    let (api_key, api_secret, url) = livekit_env()?;
    let token = create_voice_token(
        &api_key,
        &api_secret,
        &request.channel_id,
        &request.user_id,
        &request.display_name,
        "",
    )?;
    Ok(Json(JoinVoiceResponse { token, url }))
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct VoiceTokenRequest {
    pub channel_id: String,
}

/// `POST /api/voice/token`: a rota nova, só com sessão. Identidade e nome vêm
/// do banco, nunca do app.
///
/// O nome do participante é o nome visível (ou o nick, sem ele), e o nick vai
/// nos metadados (`{"nick": "..."}`): o cartão da sala mostra os dois, e a cor
/// do avatar sai do nick. Trocar o nome visível vale na próxima entrada, porque
/// o nome vai dentro do token.
pub async fn voice_token(
    CurrentUser(user): CurrentUser,
    ApiJson(request): ApiJson<VoiceTokenRequest>,
) -> Result<Json<JoinVoiceResponse>, ApiError> {
    validate_channel_id(&request.channel_id)?;
    let (api_key, api_secret, url) = livekit_env().map_err(ApiError::Config)?;
    let token = create_voice_token(
        &api_key,
        &api_secret,
        &request.channel_id,
        &user.id,
        user.shown_name(),
        &json!({ "nick": user.nick }).to_string(),
    )
    .map_err(ApiError::Config)?;
    Ok(Json(JoinVoiceResponse { token, url }))
}

#[derive(Debug, Deserialize)]
pub struct ParticipantsQuery {
    /// Ausente vira texto vazio, que o `validate_channel_id` recusa com 422.
    #[serde(default)]
    pub channel_id: String,
}

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

/// `GET /api/voice/participants?channel_id=sala`: quem está na sala agora,
/// sem precisar entrar. Sala vazia, ou que o LiveKit ainda não criou, responde
/// `[]`. O app pergunta a cada 5 segundos enquanto a tela do servidor está aberta.
pub async fn participants(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
    query: Result<Query<ParticipantsQuery>, QueryRejection>,
) -> Result<Json<Vec<ParticipantView>>, ApiError> {
    let Query(query) = query
        .map_err(|_| ApiError::InvalidRequest("O pedido não está no formato esperado.".into()))?;
    validate_channel_id(&query.channel_id)?;
    let room = list_room(&query.channel_id).await?;
    Ok(Json(join_participants(&state.db, room).await?))
}

/// Quem o LiveKit diz que está na sala: a identidade do token (o id do membro)
/// e se tem uma trilha de tela publicada.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomParticipant {
    pub identity: String,
    pub screen_sharing: bool,
}

/// Da resposta do LiveKit para o que a lista usa, na ordem em que entraram.
pub fn room_participants(mut infos: Vec<ParticipantInfo>) -> Vec<RoomParticipant> {
    infos.sort_by_key(|info| (info.joined_at, info.joined_at_ms));
    infos
        .into_iter()
        .map(|info| RoomParticipant {
            screen_sharing: info
                .tracks
                .iter()
                .any(|track| track.source() == TrackSource::ScreenShare),
            identity: info.identity,
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
async fn list_room(channel_id: &str) -> Result<Vec<RoomParticipant>, ApiError> {
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

/// Tira `identity` de toda sala em que estiver e devolve de quantas saiu. Quem
/// não está numa sala (o "não existe" do LiveKit) não é erro. O LiveKit também
/// recusa o token antigo dessa pessoa numa nova entrada; o novo, a API já não dá.
pub(crate) async fn kick_from(
    rooms: &impl VoiceRooms,
    identity: &str,
) -> Result<usize, ServiceError> {
    let mut removed = 0;
    for room in rooms.names().await? {
        match rooms.remove(&room, identity).await {
            Ok(()) => removed += 1,
            Err(error) if is_not_found(&error) => {}
            Err(error) => return Err(error),
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

/// Tamanho máximo do id de canal (e, portanto, do nome da sala no LiveKit).
const CHANNEL_ID_MAX: usize = 64;

/// O id do canal vira o nome da sala no LiveKit, que cria a sala sozinho na
/// primeira entrada. Sem lista de canais no banco, a barreira é o formato: de 1
/// a 64 caracteres, só letras ASCII, números, `_` e `-` (como `general_voice`).
fn validate_channel_id(channel_id: &str) -> Result<(), ApiError> {
    let ok = (1..=CHANNEL_ID_MAX).contains(&channel_id.len())
        && channel_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if ok {
        Ok(())
    } else {
        Err(ApiError::InvalidRequest(
            "Canal inválido: use de 1 a 64 letras, números, _ ou -.".into(),
        ))
    }
}

fn livekit_env() -> Result<(String, String, String), String> {
    let get = |name: &str| env::var(name).map_err(|error| format!("{name}: {error}"));
    Ok((
        get("LIVEKIT_API_KEY")?,
        get("LIVEKIT_API_SECRET")?,
        get("LIVEKIT_URL")?,
    ))
}

/// Monta o token da sala. `can_update_own_metadata` fica desligado: o
/// participante não consegue trocar o próprio nome ou metadados lá dentro.
fn create_voice_token(
    api_key: &str,
    api_secret: &str,
    channel_id: &str,
    user_id: &str,
    display_name: &str,
    metadata: &str,
) -> Result<String, String> {
    AccessToken::with_api_key(api_key, api_secret)
        .with_identity(user_id)
        .with_name(display_name)
        .with_metadata(metadata)
        .with_grants(VideoGrants {
            room_join: true,
            room: channel_id.to_owned(),
            can_publish: Some(true),
            can_subscribe: Some(true),
            can_update_own_metadata: Some(false),
            ..Default::default()
        })
        .to_jwt()
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use livekit_api::access_token::TokenVerifier;

    #[test]
    fn id_de_canal_valido_e_invalido() {
        for ok in ["general_voice", "gaming", "sala-1", "A", &"a".repeat(64)] {
            assert!(validate_channel_id(ok).is_ok(), "{ok}");
        }
        for bad in [
            "",
            " ",
            "com espaco",
            "../outra",
            "acentuação",
            "sala!",
            &"a".repeat(65),
        ] {
            assert!(validate_channel_id(bad).is_err(), "{bad:?}");
        }
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
            ("sala", vec!["kid", "juju"]),
            ("papo", vec!["kid"]),
            ("afk", vec!["marcao"]),
        ]);
        assert_eq!(kick_from(&rooms, "kid").await.unwrap(), 2);
        assert_eq!(*rooms.removed.lock().unwrap(), ["sala/kid", "papo/kid"]);

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

    #[test]
    fn token_leva_identidade_nome_e_nick() {
        let token = create_voice_token(
            "chave",
            "segredo-de-teste-comprido",
            "geral",
            "id-1",
            "Kid Bengala",
            r#"{"nick":"kid"}"#,
        )
        .unwrap();
        let claims = TokenVerifier::with_api_key("chave", "segredo-de-teste-comprido")
            .verify(&token)
            .unwrap();
        assert_eq!(claims.sub, "id-1");
        assert_eq!(claims.name, "Kid Bengala");
        assert_eq!(claims.metadata, r#"{"nick":"kid"}"#);
        assert_eq!(claims.video.room, "geral");
        assert_eq!(claims.video.can_update_own_metadata, Some(false));
    }
}
