use std::env;

use axum::Json;
use livekit_api::access_token::{AccessToken, VideoGrants};
use serde::{Deserialize, Serialize};

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

pub async fn join_voice(
    Json(request): Json<JoinVoiceRequest>,
) -> Result<Json<JoinVoiceResponse>, String> {
    let token = create_voice_token(&request.channel_id, &request.user_id, &request.display_name)?;
    let url = env::var("LIVEKIT_URL").map_err(|error| error.to_string())?;

    Ok(Json(JoinVoiceResponse { token, url }))
}

fn create_voice_token(
    channel_id: &str,
    user_id: &str,
    display_name: &str,
) -> Result<String, String> {
    let api_key = env::var("LIVEKIT_API_KEY").map_err(|error| error.to_string())?;
    let api_secret = env::var("LIVEKIT_API_SECRET").map_err(|error| error.to_string())?;
    let token = AccessToken::with_api_key(&api_key, &api_secret)
        .with_identity(user_id)
        .with_name(display_name)
        .with_grants(VideoGrants {
            room_join: true,
            room: channel_id.to_owned(),
            can_publish: true,
            can_subscribe: true,
            ..Default::default()
        })
        .to_jwt()
        .map_err(|error| error.to_string())?;
    Ok(token)
}
