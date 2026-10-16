//! A API do Ashtar como biblioteca: o servidor (`main.rs`) e, mais adiante,
//! o `admin` (`src/bin/admin.rs`) usam as mesmas regras e o mesmo banco.

use std::sync::Arc;

use axum::{
    Json, Router, middleware,
    routing::{get, post},
};
use serde::Serialize;
use sqlx::SqlitePool;
use tower_http::cors::CorsLayer;

use crate::client_policy::ClientPolicy;

pub mod client_policy;
pub mod db;
pub mod error;
pub mod identity;
pub mod routes;
pub mod secret;

/// Estado compartilhado pelas rotas. Clonar é barato: o pool só conta
/// referências.
#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
}

impl AppState {
    pub fn new(db: SqlitePool) -> Self {
        Self { db }
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
