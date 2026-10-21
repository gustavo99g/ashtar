//! A API do Ashtar como biblioteca: o servidor (`main.rs`) e o `admin`
//! (`src/bin/admin.rs`) usam as mesmas regras e o mesmo banco.

pub mod client_policy;
pub mod db;
pub mod error;
pub mod identity;
pub mod limiter;
pub mod routes;
pub mod secret;

use std::sync::Arc;

use axum::{
    Json, Router, middleware,
    routing::{delete, get, post, put},
};
use serde::Serialize;
use sqlx::SqlitePool;
use tower_http::cors::CorsLayer;

use client_policy::ClientPolicy;
use identity::invites::InviteKind;
use limiter::AttemptLimiter;

/// Estado compartilhado pelas rotas. Clonar é barato: o pool e os `Arc` só
/// contam referências.
#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub limiter: Arc<AttemptLimiter>,
    /// O endereço público da API (`PUBLIC_URL`), sem a barra final. Monta o
    /// link dos convites.
    pub public_url: Arc<str>,
}

impl AppState {
    pub fn new(db: SqlitePool, public_url: &str) -> Self {
        Self {
            db,
            limiter: Arc::new(AttemptLimiter::default_for_api()),
            public_url: public_url.trim_end_matches('/').into(),
        }
    }

    /// O link que a pessoa abre: `/convite/CÓDIGO` ou `/recuperar/CÓDIGO`.
    pub fn invite_link(&self, kind: InviteKind, code: &str) -> String {
        let path = match kind {
            InviteKind::New => "convite",
            InviteKind::Recovery => "recuperar",
        };
        format!("{}/{path}/{code}", self.public_url)
    }
}

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    version: String,
    message: String,
}

const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Monta todas as rotas. O `/health` fica fora da `ClientPolicy`.
pub fn app(state: AppState, policy: Arc<ClientPolicy>) -> Router {
    let api = Router::new()
        .route("/voice/join", post(routes::voice::join_voice))
        .route("/voice/token", post(routes::voice::voice_token))
        .route("/auth/redeem", post(routes::auth::redeem))
        .route("/auth/login", post(routes::auth::login))
        .route("/me", get(routes::auth::me).patch(routes::auth::update_me))
        .route(
            "/invites",
            get(routes::invites::list).post(routes::invites::create),
        )
        .route("/invites/{code}", get(routes::invites::preview))
        .route("/invites/{id}/revoke", post(routes::invites::revoke))
        .route("/members", get(routes::members::list))
        .route("/members/{id}", delete(routes::members::remove))
        .route(
            "/members/{id}/permissions",
            get(routes::members::permissions),
        )
        .route("/members/{id}/beta", put(routes::members::set_beta))
        .route("/members/{id}/unlink", post(routes::members::unlink))
        .route(
            "/members/{id}/recovery-invite",
            post(routes::members::recovery_invite),
        )
        .layer(middleware::from_fn_with_state(
            policy,
            client_policy::enforce,
        ))
        .with_state(state);

    Router::new()
        .route("/health", get(health))
        .nest("/api", api)
        .layer(CorsLayer::permissive())
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: String::from("OK"),
        version: String::from(VERSION),
        message: String::from("Server is running"),
    })
}
