//! O tempo limite de cada pedido (v0.6, decisão 14 do PLAN): um pedido que passa de
//! [`REQUEST_TIMEOUT`] é cortado com o erro `timeout`, no corpo de sempre ([`ErrorBody`]), e o app
//! oferece tentar de novo. O envio dos logs tem mais tempo ([`UPLOAD_TIMEOUT`]).
//!
//! Fica fora do WebSocket (`/api/realtime`), que vive a sessão inteira.
//!
//! [`ErrorBody`]: crate::error::ErrorBody

use std::time::Duration;

use axum::{
    extract::{Request, State},
    middleware::Next,
    response::{IntoResponse, Response},
};

use crate::error::ApiError;

/// O tempo de um pedido comum.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// O tempo do envio dos logs, que sobe um arquivo.
pub const UPLOAD_TIMEOUT: Duration = Duration::from_secs(120);
/// O tempo do envio de um arquivo do chat (até 100 MB, ADR 0031).
pub const FILE_UPLOAD_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// O middleware: `from_fn_with_state(REQUEST_TIMEOUT, timeout::limit)`.
pub async fn limit(State(after): State<Duration>, request: Request, next: Next) -> Response {
    let path = request.uri().path().to_owned();
    match tokio::time::timeout(after, next.run(request)).await {
        Ok(response) => response,
        Err(_) => {
            eprintln!("tempo limite: {path} passou de {}s", after.as_secs());
            ApiError::Timeout.into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use axum::{Router, body::Body, http::StatusCode, middleware, routing::get};
    use tower::ServiceExt;

    use super::*;

    fn app(after: Duration) -> Router {
        Router::new()
            .route("/rapido", get(|| async { "ok" }))
            .route(
                "/lento",
                get(|| async {
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    "tarde"
                }),
            )
            .layer(middleware::from_fn_with_state(after, limit))
    }

    async fn call(path: &str) -> (StatusCode, serde_json::Value) {
        let response = app(Duration::from_millis(50))
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        (status, body)
    }

    #[tokio::test]
    async fn o_pedido_que_demora_volta_com_o_erro_timeout() {
        let (status, body) = call("/lento").await;
        assert_eq!(status, StatusCode::GATEWAY_TIMEOUT);
        assert_eq!(body["kind"], "timeout");
        assert!(body["message"].as_str().unwrap().contains("demorou"));
    }

    #[tokio::test]
    async fn o_pedido_rapido_passa() {
        let (status, _) = call("/rapido").await;
        assert_eq!(status, StatusCode::OK);
    }
}
