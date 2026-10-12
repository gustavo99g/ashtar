use std::sync::Arc;

use axum::{
    Json, Router, middleware,
    routing::{get, post},
};
use dotenvy::dotenv;
use serde::Serialize;
use tower_http::cors::CorsLayer;

mod client_policy;
mod routes;

use routes::voice::join_voice;

use crate::client_policy::ClientPolicy;

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    version: String,
    message: String,
}

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[tokio::main]
async fn main() {
    dotenv().ok();
    let policy = Arc::new(ClientPolicy::from_env());
    println!(
        "Versão mínima do cliente: {}; código de acesso: {}",
        policy
            .min_version
            .as_ref()
            .map_or("desligada".into(), |v| v.to_string()),
        if policy.access_code.is_some() {
            "ligado"
        } else {
            "desligado"
        },
    );

    let api =
        Router::new()
            .route("/voice/join", post(join_voice))
            .layer(middleware::from_fn_with_state(
                policy,
                client_policy::enforce,
            ));

    let app = Router::new()
        .route("/health", get(health))
        .nest("/api", api)
        .layer(CorsLayer::permissive());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000")
        .await
        .expect("FAILED TO BIND PORT 3000 !!!");

    println!("Server running at http://127.0.0.1:3000");

    axum::serve(listener, app)
        .await
        .expect("FAILED TO SERVE !!!");
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: String::from("OK"),
        version: String::from(VERSION),
        message: String::from("Server is running"),
    })
}
