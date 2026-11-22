//! Rotas de voz: o token para entrar na sala, o da transmissão de tela e a lista de quem já está
//! nela.
//! O que fala com o LiveKit (a lista da sala, tirar alguém dela) fica em
//! [`crate::voice`].

use axum::Json;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Query, State};
use livekit_api::access_token::{AccessToken, VideoGrants};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;
use ts_rs::TS;

use super::auth::CurrentUser;
use super::extract::ApiJson;
use crate::AppState;
use crate::audit::{self, AuditKind};
use crate::calls;
use crate::chat::channels::Channel;
use crate::chat::{access, channels, dms};
use crate::error::ApiError;
use crate::identity::permissions::{Permission, require_permission};
use crate::identity::{User, users};
use crate::moderation::{self, Imposed};
use crate::realtime::{DisconnectReason, ServerEvent};
use crate::voice::{
    self, ParticipantView, RoomParticipant, join_participants, list_room, livekit_env,
    screen_identity, test_room,
};

/// A resposta do `voice/token`.
#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct JoinVoiceResponse {
    pub token: String,
    pub url: String,
    /// Silenciado pela moderação (ADR 0034): o app entra mutado e não desmuta. Só no token de voz.
    pub server_muted: bool,
    /// Com o áudio desligado pela moderação.
    pub server_deafened: bool,
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
///
/// O `channel_id` também pode ser o de uma conversa privada (ADR 0023): a sala
/// da ligação tem o nome da conversa. Aí o token é só das duas pessoas dela, e
/// só com a ligação atendida.
pub async fn voice_token(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(request): ApiJson<VoiceTokenRequest>,
) -> Result<Json<JoinVoiceResponse>, ApiError> {
    let room = check_room(&state, &user, &request.channel_id).await?;
    // A moderação vale só nas salas de voz do grupo (ADR 0034): a ligação privada sai sem travas.
    let imposed = match room {
        RoomKind::Voice => moderation::get(&state.db, &user.id).await?,
        RoomKind::Call => Imposed::default(),
    };
    let (api_key, api_secret, url) = livekit_env().map_err(ApiError::Config)?;
    let token = create_voice_token(
        &api_key,
        &api_secret,
        &request.channel_id,
        &user.id,
        user.shown_name(),
        &json!({ "nick": user.nick }).to_string(),
        imposed,
    )
    .map_err(ApiError::Config)?;
    Ok(Json(JoinVoiceResponse {
        token,
        url,
        server_muted: imposed.mic_muted,
        server_deafened: imposed.deafened,
    }))
}

/// Quanto tempo o token da tela vale para entrar. Depois de entrar, a conexão segue: a LiveKit só
/// confere o token na entrada (e o app pede outro a cada transmissão).
const SCREEN_TOKEN_TTL: Duration = Duration::from_secs(5 * 60);

/// Quantas transmissões uma sala aceita ao mesmo tempo, sem `MAX_SHARES_PER_ROOM` no `.env`.
const DEFAULT_MAX_SHARES: usize = 6;

/// O limite de transmissões por sala (ADR 0024): `MAX_SHARES_PER_ROOM`, ou 6. Um valor que não é
/// um número de 1 para cima vale o padrão: o limite é proteção da VPS, e um erro de digitação não
/// pode travar todas as transmissões.
fn max_shares() -> usize {
    parse_max_shares(std::env::var("MAX_SHARES_PER_ROOM").ok().as_deref())
}

fn parse_max_shares(value: Option<&str>) -> usize {
    value
        .and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_MAX_SHARES)
}

/// `POST /api/voice/screen-token`: o token da conexão `{user_id}:screen`, que o app usa para
/// transmitir a tela direto do Rust (ADR 0017). Só para quem já está na sala de voz: 409 para os
/// outros. Vale na ligação privada como na sala, pela mesma regra do [`voice_token`].
///
/// Com a sala no limite de transmissões, 409 `share_limit`. A própria transmissão não conta: quem
/// troca de fonte pede um token de novo. Duas pessoas pedindo o último lugar juntas podem passar as
/// duas; o limite é uma proteção, não uma conta exata.
pub async fn screen_token(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(request): ApiJson<VoiceTokenRequest>,
) -> Result<Json<JoinVoiceResponse>, ApiError> {
    check_room(&state, &user, &request.channel_id).await?;
    let room = list_room(&request.channel_id).await?;
    if !in_room(&room, &user.id) {
        return Err(ApiError::Conflict(
            "Entre na sala de voz antes de transmitir.".into(),
        ));
    }
    let limit = max_shares();
    if other_shares(&room, &user.id) >= limit {
        return Err(ApiError::ShareLimit(limit));
    }
    let (api_key, api_secret, url) = livekit_env().map_err(ApiError::Config)?;
    let token = create_screen_token(
        &api_key,
        &api_secret,
        &request.channel_id,
        &user.id,
        user.shown_name(),
        &user.nick,
    )
    .map_err(ApiError::Config)?;
    Ok(Json(JoinVoiceResponse {
        token,
        url,
        server_muted: false,
        server_deafened: false,
    }))
}

/// Quanto tempo o token do Testar conexão vale: o teste leva uns 10 segundos.
const TEST_TOKEN_TTL: Duration = Duration::from_secs(60);

/// `POST /api/voice/test-token`: o token de 1 minuto para a sala `teste:{user_id}` do Testar conexão
/// (v0.6, decisão 20). A sala é só da pessoa: ninguém mais recebe token para ela.
pub async fn test_token(
    CurrentUser(user): CurrentUser,
) -> Result<Json<JoinVoiceResponse>, ApiError> {
    let (api_key, api_secret, url) = livekit_env().map_err(ApiError::Config)?;
    let token = create_test_token(&api_key, &api_secret, &user.id).map_err(ApiError::Config)?;
    Ok(Json(JoinVoiceResponse {
        token,
        url,
        server_muted: false,
        server_deafened: false,
    }))
}

fn create_test_token(api_key: &str, api_secret: &str, user_id: &str) -> Result<String, String> {
    AccessToken::with_api_key(api_key, api_secret)
        .with_identity(user_id)
        .with_ttl(TEST_TOKEN_TTL)
        .with_grants(VideoGrants {
            room_join: true,
            room: test_room(user_id),
            can_publish: Some(true),
            can_subscribe: Some(true),
            can_publish_data: Some(false),
            can_publish_sources: vec!["microphone".into()],
            can_update_own_metadata: Some(false),
            ..Default::default()
        })
        .to_jwt()
        .map_err(|error| error.to_string())
}

/// Que sala é a de um token: uma sala de voz do grupo ou a de uma ligação privada.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RoomKind {
    Voice,
    Call,
}

/// Se `user` pode entrar na sala `channel_id`: uma sala de voz aberta, ou a
/// conversa privada dele com a ligação atendida. A conversa dos outros cai no
/// mesmo 404 de uma sala que não existe; a própria, sem ligação atendida, 409.
async fn check_room(state: &AppState, user: &User, channel_id: &str) -> Result<RoomKind, ApiError> {
    validate_channel_id(channel_id)?;
    if let Some(dm) = dms::find_for(&state.db, &user.id, channel_id).await? {
        return if calls::is_answered(&state.db, &dm.id).await? {
            Ok(RoomKind::Call)
        } else {
            Err(ApiError::Conflict(
                "A ligação ainda não foi atendida.".into(),
            ))
        };
    }
    access::joinable(&state.db, user, channel_id).await?;
    Ok(RoomKind::Voice)
}

/// Se `user_id` está na sala pela voz (a `:screen` não conta: ela some da lista).
fn in_room(room: &[RoomParticipant], user_id: &str) -> bool {
    room.iter().any(|p| p.identity == user_id)
}

/// Quantas pessoas, fora `user_id`, estão transmitindo na sala.
fn other_shares(room: &[RoomParticipant], user_id: &str) -> usize {
    room.iter()
        .filter(|p| p.screen_sharing && p.identity != user_id)
        .count()
}

#[derive(Debug, Deserialize)]
pub struct ParticipantsQuery {
    /// Ausente vira texto vazio, que o `validate_channel_id` recusa com 422.
    #[serde(default)]
    pub channel_id: String,
}

/// Monta o token da tela: publica só a tela e o áudio dela, não assina nada (quem transmite já
/// ouve a sala pela voz) e não manda dados. O dono e o nick dele vão nos metadados
/// (`{"screenOf": id, "nick": "..."}`), com o mesmo nome da voz: o app mostra a tela como de quem
/// transmite.
fn create_screen_token(
    api_key: &str,
    api_secret: &str,
    channel_id: &str,
    user_id: &str,
    display_name: &str,
    nick: &str,
) -> Result<String, String> {
    AccessToken::with_api_key(api_key, api_secret)
        .with_identity(&screen_identity(user_id))
        .with_name(display_name)
        .with_metadata(&json!({ "screenOf": user_id, "nick": nick }).to_string())
        .with_ttl(SCREEN_TOKEN_TTL)
        .with_grants(VideoGrants {
            room_join: true,
            room: channel_id.to_owned(),
            can_publish: Some(true),
            can_subscribe: Some(false),
            can_publish_data: Some(false),
            can_publish_sources: vec!["screen_share".into(), "screen_share_audio".into()],
            can_update_own_metadata: Some(false),
            ..Default::default()
        })
        .to_jwt()
        .map_err(|error| error.to_string())
}

/// `GET /api/voice/participants?channel_id=sala`: quem está na sala agora,
/// sem precisar entrar. Sala vazia, ou que o LiveKit ainda não criou, responde
/// `[]`. O app pergunta a cada 5 segundos enquanto a tela do servidor está aberta.
pub async fn participants(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    query: Result<Query<ParticipantsQuery>, QueryRejection>,
) -> Result<Json<Vec<ParticipantView>>, ApiError> {
    let Query(query) = query
        .map_err(|_| ApiError::InvalidRequest("O pedido não está no formato esperado.".into()))?;
    validate_channel_id(&query.channel_id)?;
    access::joinable(&state.db, &user, &query.channel_id).await?;
    let room = list_room(&query.channel_id).await?;
    let list = join_participants(&state.db, room).await?;
    Ok(Json(state.hub.with_voice_flags(&query.channel_id, list)))
}

/// O que o app manda no `PUT /api/voice/state`.
#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct VoiceStateRequest {
    pub channel_id: String,
    #[serde(flatten)]
    #[ts(flatten)]
    pub flags: voice::VoiceFlags,
}

/// Quanto esperar para reler a sala de novo depois de alguém entrar ou sair: o LiveKit pode
/// ainda não ter a mudança na primeira leitura.
const REREAD_AGAIN: Duration = Duration::from_millis(1500);

/// Relê a sala agora e de novo daqui a pouco. Com o webhook do LiveKit (a VPS), é só reforço; sem
/// ele (o `livekit-server --dev` sem configuração), é o que mostra quem entrou e saiu.
fn reread_soon(state: &AppState, room: String) {
    let state = state.clone();
    tokio::spawn(async move {
        super::webhooks::reread(state.clone(), room.clone()).await;
        tokio::time::sleep(REREAD_AGAIN).await;
        super::webhooks::reread(state, room).await;
    });
}

/// `PUT /api/voice/state`: o app conta o próprio estado na sala de voz do grupo (microfone, áudio,
/// câmera e tela), a cada mudança e ao entrar. A API publica a lista da sala com ele para quem
/// está de fora. Ligações privadas não passam por aqui (404, como uma sala que não existe).
pub async fn voice_state(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(request): ApiJson<VoiceStateRequest>,
) -> Result<axum::http::StatusCode, ApiError> {
    validate_channel_id(&request.channel_id)?;
    let room = access::joinable(&state.db, &user, &request.channel_id).await?;
    let mut flags = request.flags;
    flags.share = flags.share.map(voice::ShareInfo::clamp);
    match state.hub.set_voice_flags(&user.id, &room.id, flags) {
        Some(list) => {
            let to = access::audience(&state.db, &room.id).await?;
            state.hub.publish_voice_participants(room.id, list, to);
        }
        // A lista ainda não tem a pessoa: acabou de entrar.
        None => reread_soon(&state, room.id),
    }
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// `DELETE /api/voice/state?channel_id=sala`: o app saiu da sala. A API esquece o estado (se
/// ainda é dessa sala: ao trocar de sala, o da nova pode chegar antes) e relê a sala.
pub async fn leave_voice_state(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    query: Result<Query<ParticipantsQuery>, QueryRejection>,
) -> Result<axum::http::StatusCode, ApiError> {
    let Query(query) = query
        .map_err(|_| ApiError::InvalidRequest("O pedido não está no formato esperado.".into()))?;
    validate_channel_id(&query.channel_id)?;
    let room = access::joinable(&state.db, &user, &query.channel_id).await?;
    state.hub.clear_voice_flags(&user.id, &room.id);
    reread_soon(&state, room.id);
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// Quanto o app de quem foi movido tem para trocar de sala sozinho, antes de a
/// API tirá-lo da sala antiga (o app antigo não conhece o `voice.moved`).
pub const MOVE_GRACE: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct MoveMemberRequest {
    pub user_id: String,
    pub channel_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct DisconnectMemberRequest {
    pub user_id: String,
}

/// A sala de voz do grupo em que `user_id` está: pela lista que o hub guarda e,
/// sem ela, perguntando ao LiveKit. Uma ligação privada não conta: ninguém é
/// movido de dentro de uma.
pub(crate) async fn voice_room_of(
    state: &AppState,
    user_id: &str,
) -> Result<Option<String>, ApiError> {
    let room = match state.hub.room_of(user_id) {
        Some(room) => Some(room),
        None => voice::find_room_of(user_id).await?,
    };
    let Some(room) = room else { return Ok(None) };
    Ok(channels::get_open_voice(&state.db, &room)
        .await
        .ok()
        .map(|channel| channel.id))
}

/// O membro ativo `user_id`, ou 404.
pub(crate) async fn active_member(state: &AppState, user_id: &str) -> Result<User, ApiError> {
    users::find_by_id(&state.db, user_id)
        .await?
        .filter(User::is_active)
        .ok_or_else(|| ApiError::NotFound("Nenhum membro com esse id.".into()))
}

/// `POST /api/voice/move`: põe alguém em outra sala de voz (ADR 0026). Só com
/// "Mover membros". A API não move ninguém sozinha: manda o `voice.moved` para
/// as conexões da pessoa, e o app dela troca de sala pelo mesmo caminho do
/// clique. Se ela continuar na sala antiga depois de [`MOVE_GRACE`] (um app que
/// não conhece o evento), a API a tira de lá.
///
/// 409 para quem não está numa sala de voz (nem numa ligação conta), para quem
/// já está na sala de destino e para quem não acessa a sala restrita. Uma sala
/// restrita que quem move não acessa dá o 404 de uma que não existe.
pub async fn move_member(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(request): ApiJson<MoveMemberRequest>,
) -> Result<axum::http::StatusCode, ApiError> {
    require_permission(&state.db, &user, Permission::MoveMembers).await?;
    let target = active_member(&state, &request.user_id).await?;
    validate_channel_id(&request.channel_id)?;
    let destination = access::joinable(&state.db, &user, &request.channel_id).await?;
    if !access::can_access(&state.db, &target, &destination).await? {
        return Err(ApiError::Conflict(
            "Essa pessoa não tem acesso a essa sala.".into(),
        ));
    }
    let Some(from) = voice_room_of(&state, &target.id).await? else {
        return Err(ApiError::Conflict(
            "Essa pessoa não está numa sala de voz.".into(),
        ));
    };
    if from == destination.id {
        return Err(ApiError::Conflict("Essa pessoa já está nessa sala.".into()));
    }
    audit::record(
        &state.db,
        audit::Entry {
            kind: AuditKind::Voice,
            action: "voz.mover",
            actor: &user,
            target: Some(&target),
            place: audit::channel_name(&state.db, &from).await?,
            detail: Some(destination.name.clone()),
        },
        crate::db::now(),
    )
    .await?;
    state.hub.publish_to(
        &[&target.id],
        &ServerEvent::VoiceMoved {
            channel_id: destination.id,
            by: user.id.clone(),
            by_name: user.shown_name().to_owned(),
        },
    );
    let hub = state.hub.clone();
    let grace = state.move_grace;
    tokio::spawn(async move {
        tokio::time::sleep(grace).await;
        if hub.room_of(&target.id).as_deref() == Some(from.as_str()) {
            voice::remove_from_room_in_background(from, target.id);
        }
    });
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// `POST /api/voice/disconnect`: tira alguém da voz (ADR 0026), com a mesma
/// permissão de mover. O `voice.disconnected` vai antes, para o app dela mostrar
/// quem desconectou e não tentar voltar; a conexão cai em seguida.
pub async fn disconnect_member(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(request): ApiJson<DisconnectMemberRequest>,
) -> Result<axum::http::StatusCode, ApiError> {
    require_permission(&state.db, &user, Permission::MoveMembers).await?;
    let target = active_member(&state, &request.user_id).await?;
    let Some(from) = voice_room_of(&state, &target.id).await? else {
        return Err(ApiError::Conflict(
            "Essa pessoa não está numa sala de voz.".into(),
        ));
    };
    audit::record(
        &state.db,
        audit::Entry {
            kind: AuditKind::Voice,
            action: "voz.desconectar",
            actor: &user,
            target: Some(&target),
            place: audit::channel_name(&state.db, &from).await?,
            detail: None,
        },
        crate::db::now(),
    )
    .await?;
    state.hub.publish_to(
        &[&target.id],
        &ServerEvent::VoiceDisconnected {
            by: user.id.clone(),
            by_name: user.shown_name().to_owned(),
            reason: DisconnectReason::Moderator,
        },
    );
    voice::remove_from_room_in_background(from, target.id);
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// Tira da sala `room` quem está nela e perdeu o acesso (ADR 0028), depois de
/// `by` mudar a lista: o `voice.disconnected` com `no_access` e, em seguida, as
/// conexões. Quem está na sala vem da lista que o hub guarda.
pub(crate) async fn remove_without_access(
    state: &AppState,
    room: &Channel,
    by: &User,
) -> Result<(), ApiError> {
    for user_id in state.hub.people_in(&room.id) {
        let Some(person) = users::find_by_id(&state.db, &user_id).await? else {
            continue;
        };
        if access::can_access(&state.db, &person, room).await? {
            continue;
        }
        state.hub.publish_to(
            &[&person.id],
            &ServerEvent::VoiceDisconnected {
                by: by.id.clone(),
                by_name: by.shown_name().to_owned(),
                reason: DisconnectReason::NoAccess,
            },
        );
        voice::remove_from_room_in_background(room.id.clone(), person.id);
    }
    Ok(())
}

/// Tamanho máximo do id de canal (e, portanto, do nome da sala no LiveKit).
const CHANNEL_ID_MAX: usize = 64;

/// O id do canal vira o nome da sala no LiveKit, que cria a sala sozinho na
/// primeira entrada. A primeira barreira é o formato, sem ir ao banco: de 1 a 64
/// caracteres, só letras ASCII, números, `_` e `-` (como `general_voice`). A
/// segunda é a sala existir no banco ([`channels::get_open_voice`]).
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

/// Monta o token da sala. `can_update_own_metadata` fica desligado: o
/// participante não consegue trocar o próprio nome ou metadados lá dentro. Com a moderação
/// (`imposed`), a entrada já nasce travada: sem o microfone nas fontes, ou sem receber o áudio.
fn create_voice_token(
    api_key: &str,
    api_secret: &str,
    channel_id: &str,
    user_id: &str,
    display_name: &str,
    metadata: &str,
    imposed: Imposed,
) -> Result<String, String> {
    AccessToken::with_api_key(api_key, api_secret)
        .with_identity(user_id)
        .with_name(display_name)
        .with_metadata(metadata)
        .with_grants(VideoGrants {
            room_join: true,
            room: channel_id.to_owned(),
            can_publish: Some(true),
            can_subscribe: Some(!imposed.deafened),
            can_publish_sources: imposed.token_sources(),
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
    fn token_da_tela_so_publica_a_tela() {
        let token = create_screen_token(
            "chave",
            "segredo-de-teste-comprido",
            "geral",
            "id-1",
            "Kid",
            "kid",
        )
        .unwrap();
        let claims = TokenVerifier::with_api_key("chave", "segredo-de-teste-comprido")
            .verify(&token)
            .unwrap();
        assert_eq!(claims.sub, "id-1:screen");
        assert_eq!(claims.name, "Kid");
        assert_eq!(claims.metadata, r#"{"nick":"kid","screenOf":"id-1"}"#);
        assert_eq!(claims.video.room, "geral");
        assert_eq!(claims.video.can_publish, Some(true));
        assert_eq!(claims.video.can_subscribe, Some(false));
        assert_eq!(claims.video.can_publish_data, Some(false));
        assert_eq!(
            claims.video.can_publish_sources,
            ["screen_share", "screen_share_audio"]
        );
        assert_eq!(claims.exp - claims.nbf, 5 * 60);
    }

    #[test]
    fn so_transmite_quem_esta_na_sala_pela_voz() {
        let room = [
            RoomParticipant {
                identity: "kid".into(),
                screen_sharing: false,
            },
            RoomParticipant {
                identity: "juju".into(),
                screen_sharing: true,
            },
        ];
        assert!(in_room(&room, "kid"));
        assert!(!in_room(&room, "marcao"));
        assert!(!in_room(&[], "kid"));
    }

    #[test]
    fn a_propria_transmissao_nao_conta_no_limite() {
        let person = |identity: &str, screen_sharing| RoomParticipant {
            identity: identity.into(),
            screen_sharing,
        };
        let room = [
            person("kid", true),
            person("juju", true),
            person("marcao", false),
            person("rafa", true),
        ];
        assert_eq!(other_shares(&room, "kid"), 2);
        assert_eq!(other_shares(&room, "marcao"), 3);
        assert_eq!(other_shares(&[], "kid"), 0);
    }

    #[test]
    fn limite_de_transmissoes_do_env() {
        assert_eq!(parse_max_shares(None), DEFAULT_MAX_SHARES);
        for (value, expected) in [("3", 3), (" 2 ", 2), ("0", 6), ("muitas", 6), ("", 6)] {
            assert_eq!(parse_max_shares(Some(value)), expected, "{value:?}");
        }
    }

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

    #[test]
    fn token_leva_identidade_nome_e_nick() {
        let token = create_voice_token(
            "chave",
            "segredo-de-teste-comprido",
            "geral",
            "id-1",
            "Kid",
            r#"{"nick":"kid"}"#,
            Imposed::default(),
        )
        .unwrap();
        let claims = TokenVerifier::with_api_key("chave", "segredo-de-teste-comprido")
            .verify(&token)
            .unwrap();
        assert_eq!(claims.sub, "id-1");
        assert_eq!(claims.name, "Kid");
        assert_eq!(claims.metadata, r#"{"nick":"kid"}"#);
        assert_eq!(claims.video.room, "geral");
        assert_eq!(claims.video.can_update_own_metadata, Some(false));
        assert_eq!(claims.video.can_subscribe, Some(true));
        assert!(claims.video.can_publish_sources.is_empty());
    }

    #[test]
    fn o_token_de_quem_foi_moderado_ja_sai_travado() {
        let token = create_voice_token(
            "chave",
            "segredo-de-teste-comprido",
            "geral",
            "id-1",
            "Kid",
            "{}",
            Imposed {
                mic_muted: true,
                deafened: true,
            },
        )
        .unwrap();
        let claims = TokenVerifier::with_api_key("chave", "segredo-de-teste-comprido")
            .verify(&token)
            .unwrap();
        assert_eq!(claims.video.can_subscribe, Some(false));
        assert_eq!(
            claims.video.can_publish_sources,
            ["camera", "screen_share", "screen_share_audio"]
        );
    }

    #[test]
    fn o_token_do_teste_e_so_da_sala_da_pessoa_e_vale_um_minuto() {
        let token = create_test_token("chave", "segredo-de-teste-comprido", "id-1").unwrap();
        let claims = TokenVerifier::with_api_key("chave", "segredo-de-teste-comprido")
            .verify(&token)
            .unwrap();
        assert_eq!(claims.sub, "id-1");
        assert_eq!(claims.video.room, "teste:id-1");
        assert_eq!(
            claims.video.can_publish_sources,
            vec!["microphone".to_string()]
        );
        assert!(claims.exp - claims.nbf <= 60);
    }
}
