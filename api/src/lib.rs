//! A API do Ashtar como biblioteca: o servidor (`main.rs`) e o `admin`
//! (`src/bin/admin.rs`) usam as mesmas regras e o mesmo banco.

pub mod avatar;
pub mod calls;
pub mod chat;
pub mod client_policy;
pub mod db;
pub mod download;
pub mod error;
pub mod identity;
pub mod limiter;
pub mod realtime;
pub mod routes;
pub mod secret;
pub mod timeout;
pub mod voice;

use std::sync::Arc;

use axum::{
    Json, Router, middleware,
    routing::{delete, get, patch, post, put},
};
use serde::Serialize;
use sqlx::SqlitePool;
use tower_http::cors::CorsLayer;

use client_policy::ClientPolicy;
use download::DownloadLink;
use identity::invites::InviteKind;
use limiter::{AttemptLimiter, SendLimiter};
use livekit_api::access_token::TokenVerifier;
use livekit_api::webhooks::WebhookReceiver;
use realtime::Hub;

/// Estado compartilhado pelas rotas. Clonar é barato: o pool e os `Arc` só
/// contam referências.
#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub limiter: Arc<AttemptLimiter>,
    /// O limite de envio do chat, por pessoa.
    pub send_limiter: Arc<SendLimiter>,
    /// O tempo real: os WebSockets abertos, os tickets e quem está online.
    pub hub: Arc<Hub>,
    /// Confere a assinatura do webhook do LiveKit. `None` sem as chaves no
    /// ambiente: a rota responde 503.
    pub webhook: Option<Arc<WebhookReceiver>>,
    /// O endereço público da API (`PUBLIC_URL`), sem a barra final. Monta o
    /// link dos convites.
    pub public_url: Arc<str>,
    /// O instalador do "Baixar para Windows", lido do `latest.json`.
    pub download: Arc<DownloadLink>,
    /// Quanto a ligação toca antes de virar perdida ([`calls::RING_TIMEOUT`];
    /// os testes usam menos).
    pub ring_timeout: std::time::Duration,
    /// Quanto quem foi movido tem para trocar de sala sozinho
    /// ([`routes::voice::MOVE_GRACE`]; os testes usam menos).
    pub move_grace: std::time::Duration,
}

impl AppState {
    pub fn new(db: SqlitePool, public_url: &str) -> Self {
        Self {
            db,
            limiter: Arc::new(AttemptLimiter::default_for_api()),
            send_limiter: Arc::new(SendLimiter::default_for_chat()),
            hub: Arc::new(Hub::default()),
            webhook: TokenVerifier::new()
                .ok()
                .map(|verifier| Arc::new(WebhookReceiver::new(verifier))),
            public_url: public_url.trim_end_matches('/').into(),
            download: Arc::new(DownloadLink::default()),
            ring_timeout: calls::RING_TIMEOUT,
            move_grace: routes::voice::MOVE_GRACE,
        }
    }

    /// O link que a pessoa abre: `/invite/CÓDIGO` ou `/recovery/CÓDIGO`.
    pub fn invite_link(&self, kind: InviteKind, code: &str) -> String {
        let path = match kind {
            InviteKind::New => "invite",
            InviteKind::Recovery => "recovery",
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

/// Monta todas as rotas. O `/health` e as páginas do convite ficam fora da
/// `ClientPolicy`: quem as abre é o navegador, não o app.
pub fn app(state: AppState, policy: Arc<ClientPolicy>) -> Router {
    let pages = Router::new()
        .route("/invite/{code}", get(routes::pages::invite))
        .route("/recovery/{code}", get(routes::pages::recovery))
        .route("/invite.png", get(routes::pages::icon))
        .route("/download", get(routes::pages::download))
        .with_state(state.clone());

    let api = Router::new()
        .route("/voice/token", post(routes::voice::voice_token))
        .route("/voice/participants", get(routes::voice::participants))
        .route("/voice/screen-token", post(routes::voice::screen_token))
        .route("/voice/test-token", post(routes::voice::test_token))
        .route("/voice/move", post(routes::voice::move_member))
        .route("/voice/disconnect", post(routes::voice::disconnect_member))
        .route("/auth/redeem", post(routes::auth::redeem))
        .route("/auth/login", post(routes::auth::login))
        .route("/me", get(routes::auth::me).patch(routes::auth::update_me))
        .route("/me/status", put(routes::auth::set_status))
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
        .route(
            "/members/{id}/permissions/{key}",
            put(routes::members::set_permission),
        )
        .route("/members/{id}/unlink", post(routes::members::unlink))
        .route(
            "/members/{id}/recovery-invite",
            post(routes::members::recovery_invite),
        )
        .route(
            "/channels/{id}/messages",
            get(routes::messages::list).post(routes::messages::send),
        )
        .route("/channels/{id}/read", put(routes::read::mark_read))
        .route("/channels/{id}/mute", put(routes::read::set_muted))
        .route("/read-all", post(routes::read::mark_all_read))
        .route("/people", get(routes::people::list))
        .route("/dms", get(routes::dms::list).post(routes::dms::open))
        .route("/dms/{id}/call", post(routes::calls::start))
        .route("/dms/{id}/call/accept", post(routes::calls::accept))
        .route("/dms/{id}/call/decline", post(routes::calls::decline))
        .route("/dms/{id}/call/cancel", post(routes::calls::cancel))
        .route("/dms/{id}/call/end", post(routes::calls::end))
        .route(
            "/channels",
            get(routes::channels::list).post(routes::channels::create),
        )
        .route("/channels/archived", get(routes::channels::archived))
        .route("/channels/layout", put(routes::channels::set_layout))
        .route("/channels/{id}", patch(routes::channels::update))
        .route("/channels/{id}/archive", post(routes::channels::archive))
        .route(
            "/channels/{id}/unarchive",
            post(routes::channels::unarchive),
        )
        .route("/categories", post(routes::channels::create_category))
        .route("/categories/{id}", patch(routes::channels::rename_category))
        .route(
            "/categories/{id}/archive",
            post(routes::channels::archive_category),
        )
        .route(
            "/categories/{id}/unarchive",
            post(routes::channels::unarchive_category),
        )
        .route("/realtime/ticket", post(routes::realtime::ticket))
        .layer(middleware::from_fn_with_state(
            timeout::REQUEST_TIMEOUT,
            timeout::limit,
        ))
        .layer(middleware::from_fn_with_state(
            policy,
            client_policy::enforce,
        ))
        .with_state(state.clone());
    // Fora da `ClientPolicy`: o WebSocket do navegador não manda cabeçalho, e o
    // webhook vem do LiveKit. Cada um confere quem chama do seu jeito.
    let outside_policy = Router::new()
        .route("/api/realtime", get(routes::realtime::connect))
        .route("/webhooks/livekit", post(routes::webhooks::livekit))
        .with_state(state);

    Router::new()
        .route("/health", get(health))
        .nest("/api", api)
        .merge(pages)
        .merge(outside_policy)
        .layer(CorsLayer::permissive())
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: String::from("OK"),
        version: String::from(VERSION),
        message: String::from("Server is running"),
    })
}
