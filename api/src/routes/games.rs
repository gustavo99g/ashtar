//! `GET /api/games/detectable`: a lista de jogos detectáveis que a API guarda ([`crate::games`]).

use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};

use super::auth::CurrentUser;
use crate::AppState;

/// A lista inteira, com `ETag`. Com o `If-None-Match` igual, `304` sem corpo: o app já tem. Antes
/// da primeira busca boa, `[]` sem `ETag` (o app fica com a cópia dele).
pub async fn detectable(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
    headers: HeaderMap,
) -> Response {
    let Some((json, etag)) = state.games.current() else {
        return ([(header::CONTENT_TYPE, "application/json")], "[]").into_response();
    };
    let tag = HeaderValue::from_str(&etag).expect("o ETag é hexadecimal");
    if headers.get(header::IF_NONE_MATCH) == Some(&tag) {
        return (StatusCode::NOT_MODIFIED, [(header::ETAG, tag)]).into_response();
    }
    (
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            ),
            (header::ETAG, tag),
        ],
        json,
    )
        .into_response()
}
