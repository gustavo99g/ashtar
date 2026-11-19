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
use crate::calls;
use crate::chat::{channels, dms};
use crate::error::ApiError;
use crate::identity::User;
use crate::voice::{
    ParticipantView, RoomParticipant, join_participants, list_room, livekit_env, screen_identity,
};

/// A resposta do `voice/token`.
#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct JoinVoiceResponse {
    pub token: String,
    pub url: String,
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
    check_room(&state, &user, &request.channel_id).await?;
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
    Ok(Json(JoinVoiceResponse { token, url }))
}

/// Se `user` pode entrar na sala `channel_id`: uma sala de voz aberta, ou a
/// conversa privada dele com a ligação atendida. A conversa dos outros cai no
/// mesmo 404 de uma sala que não existe; a própria, sem ligação atendida, 409.
async fn check_room(state: &AppState, user: &User, channel_id: &str) -> Result<(), ApiError> {
    validate_channel_id(channel_id)?;
    if let Some(dm) = dms::find_for(&state.db, &user.id, channel_id).await? {
        return if calls::is_answered(&state.db, &dm.id).await? {
            Ok(())
        } else {
            Err(ApiError::Conflict(
                "A ligação ainda não foi atendida.".into(),
            ))
        };
    }
    channels::get_open_voice(&state.db, channel_id).await?;
    Ok(())
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
    CurrentUser(_user): CurrentUser,
    query: Result<Query<ParticipantsQuery>, QueryRejection>,
) -> Result<Json<Vec<ParticipantView>>, ApiError> {
    let Query(query) = query
        .map_err(|_| ApiError::InvalidRequest("O pedido não está no formato esperado.".into()))?;
    validate_channel_id(&query.channel_id)?;
    channels::get_open_voice(&state.db, &query.channel_id).await?;
    let room = list_room(&query.channel_id).await?;
    Ok(Json(join_participants(&state.db, room).await?))
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
    }
}
