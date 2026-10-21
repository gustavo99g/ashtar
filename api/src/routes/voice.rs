use std::env;

use axum::Json;
use livekit_api::access_token::{AccessToken, VideoGrants};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::auth::CurrentUser;
use super::extract::ApiJson;
use crate::error::ApiError;

#[derive(Debug, Deserialize)]
pub struct JoinVoiceRequest {
    pub channel_id: String,
    pub user_id: String,
    pub display_name: String,
}

#[derive(Debug, Serialize)]
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

#[derive(Debug, Deserialize)]
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
            can_publish: true,
            can_subscribe: true,
            can_update_own_metadata: false,
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
        assert_eq!(claims.video.room, "geral");
        assert!(!claims.video.can_update_own_metadata);
        assert_eq!(claims.metadata, r#"{"nick":"kid"}"#);
    }
}
