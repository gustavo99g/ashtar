use axum::{
    Json, Router,
    routing::{get, post},
};
use dotenvy::dotenv;
use serde::Serialize;

mod routes;

use routes::voice::join_voice;

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
    let app = Router::new()
        .route("/health", get(health))
        .route("/api/voice/join", post(join_voice));

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
