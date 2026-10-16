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
    routing::{get, post},
};
use serde::Serialize;
use sqlx::SqlitePool;
use tower_http::cors::CorsLayer;

use client_policy::ClientPolicy;
use limiter::AttemptLimiter;

/// Estado compartilhado pelas rotas. Clonar é barato: o pool e o `Arc` só
/// contam referências.
#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub limiter: Arc<AttemptLimiter>,
}

impl AppState {
    pub fn new(db: SqlitePool) -> Self {
        Self {
            db,
            limiter: Arc::new(AttemptLimiter::default_for_api()),
        }
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
        .route("/me", get(routes::auth::me))
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
