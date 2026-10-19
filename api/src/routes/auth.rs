//! Rotas de entrada: usar convite, entrar com o dispositivo e `/api/me`.
//!
//! Ninguém usa estas rotas ainda: o desktop passa a chamá-las junto com a
//! parte visual. Até lá, dá para testá-las com `curl`.

use axum::Json;
use axum::extract::{FromRequestParts, State};
use axum::http::HeaderMap;
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::db::now;
use crate::error::ApiError;
use crate::identity::permissions::{self, Action, Permission};
use crate::identity::{User, devices, invites};

use super::extract::ApiJson;

#[derive(Debug, Deserialize)]
pub struct RedeemRequest {
    pub code: String,
    pub device_key: String,
    /// Obrigatório no convite novo; ignorado no de recuperação.
    pub nick: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub device_key: String,
}

#[derive(Debug, Serialize)]
pub struct SessionResponse {
    pub token: String,
    pub user: UserView,
}

#[derive(Debug, Serialize)]
pub struct UserView {
    pub id: String,
    pub nick: String,
    pub is_owner: bool,
}

impl From<&User> for UserView {
    fn from(user: &User) -> Self {
        Self {
            id: user.id.clone(),
            nick: user.nick.clone(),
            is_owner: user.is_owner,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct MeResponse {
    pub user: UserView,
    /// Chaves das permissões que o membro tem.
    pub permissions: Vec<&'static str>,
    /// `"beta"` ou `"stable"`: de onde o app busca atualizações.
    pub update_channel: &'static str,
    /// O que mostrar ou esconder na interface. Quem decide de verdade é a API.
    pub can_create_invite: bool,
}

/// `POST /api/auth/redeem`: usa um convite e já devolve a sessão.
pub async fn redeem(
    State(state): State<AppState>,
    ApiJson(request): ApiJson<RedeemRequest>,
) -> Result<Json<SessionResponse>, ApiError> {
    state.limiter.check()?;
    let result = invites::redeem(
        &state.db,
        &request.code,
        &request.device_key,
        request.nick.as_deref(),
        now(),
    )
    .await;
    if matches!(result, Err(ApiError::InvalidInvite)) {
        state.limiter.record_failure();
    }
    let (user, token) = result?;
    Ok(Json(SessionResponse {
        token,
        user: UserView::from(&user),
    }))
}

/// `POST /api/auth/login`: entra com um dispositivo já vinculado.
///
/// Fica fora do limite de tentativas, de propósito: a chave do dispositivo tem
/// 256 bits, então adivinhá-la é inviável; e todo app de quem ainda não tem
/// convite chama o login ao abrir (e recebe `unknown_device`), o que travaria os
/// convites de todos. Bloquear o login também deixaria de fora quem já é membro.
pub async fn login(
    State(state): State<AppState>,
    ApiJson(request): ApiJson<LoginRequest>,
) -> Result<Json<SessionResponse>, ApiError> {
    let (user, token) = devices::login(&state.db, &request.device_key, now()).await?;
    Ok(Json(SessionResponse {
        token,
        user: UserView::from(&user),
    }))
}

/// `GET /api/me`: quem sou, o que posso e qual canal de atualização uso.
pub async fn me(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<MeResponse>, ApiError> {
    let effective = permissions::effective(&state.db, &user).await?;
    let beta = effective.iter().any(|(p, _)| *p == Permission::BetaUpdates);

    Ok(Json(MeResponse {
        user: UserView::from(&user),
        permissions: effective.iter().map(|(p, _)| p.key()).collect(),
        update_channel: if beta { "beta" } else { "stable" },
        can_create_invite: permissions::can(&user, Action::CreateInvite),
    }))
}

/// Extrator: o membro do `Authorization: Bearer <token>`. Sem token, token
/// inválido ou membro removido, a rota responde 401 sem rodar.
pub struct CurrentUser(pub User);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let token = bearer_token(&parts.headers).ok_or(ApiError::Unauthenticated)?;
        let user = devices::authenticate(&state.db, token, now()).await?;
        Ok(Self(user))
    }
}

/// O token de `Authorization: Bearer <token>`. O esquema não diferencia
/// maiúscula de minúscula (RFC 9110), e o token não pode ser vazio.
fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    let token = token.trim();
    (scheme.eq_ignore_ascii_case("bearer") && !token.is_empty()).then_some(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(value: &str) -> HeaderMap {
        let mut map = HeaderMap::new();
        map.insert(AUTHORIZATION, value.parse().unwrap());
        map
    }

    #[test]
    fn o_esquema_nao_diferencia_maiuscula() {
        for scheme in ["Bearer", "bearer", "BEARER"] {
            let map = headers(&format!("{scheme} abc123"));
            assert_eq!(bearer_token(&map), Some("abc123"));
        }
    }

    #[test]
    fn recusa_o_que_nao_e_bearer_com_token() {
        assert_eq!(bearer_token(&HeaderMap::new()), None);
        assert_eq!(bearer_token(&headers("Basic abc123")), None);
        assert_eq!(bearer_token(&headers("Bearer")), None);
        assert_eq!(bearer_token(&headers("Bearer   ")), None);
        assert_eq!(bearer_token(&headers("abc123")), None);
    }
}
