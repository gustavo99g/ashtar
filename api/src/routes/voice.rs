//! Rotas de voz: o token para entrar na sala e a lista de quem já está nela.
//! O que fala com o LiveKit (a lista da sala, tirar alguém dela) fica em
//! [`crate::voice`].

use axum::Json;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Query, State};
use livekit_api::access_token::{AccessToken, VideoGrants};
use serde::{Deserialize, Serialize};
use serde_json::json;
use ts_rs::TS;

use super::auth::CurrentUser;
use super::extract::ApiJson;
use crate::AppState;
use crate::error::ApiError;
use crate::voice::{ParticipantView, join_participants, list_room, livekit_env};

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
