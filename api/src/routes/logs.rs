//! O "Enviar logs" (v0.6, decisões 16 e 17): qualquer membro manda; só o dono lista e baixa. Para
//! os outros, a lista e o arquivo respondem 404, como se não existissem.

use axum::Json;
use axum::body::Body;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, header};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;

use super::auth::CurrentUser;
use crate::AppState;
use crate::db::now;
use crate::error::ApiError;
use crate::identity::{User, users};
use crate::logs::{self, LogReportView};
use crate::realtime::ServerEvent;

#[derive(Debug, Deserialize)]
pub struct UploadQuery {
    /// O "O que aconteceu?", opcional.
    pub note: Option<String>,
}

fn not_found() -> ApiError {
    ApiError::NotFound("Não encontrado.".into())
}

fn require_owner(user: &User) -> Result<(), ApiError> {
    if user.is_owner {
        Ok(())
    } else {
        Err(not_found())
    }
}

/// `POST /api/logs?note=...`: o corpo é o `.zip` que o app juntou (até 10 MB), e a versão vem do
/// `X-App-Version`. Um envio a cada 5 minutos por pessoa. O dono recebe o `logs.received`.
pub async fn upload(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    headers: HeaderMap,
    query: Result<Query<UploadQuery>, QueryRejection>,
    body: Body,
) -> Result<Json<LogReportView>, ApiError> {
    let Query(query) = query
        .map_err(|_| ApiError::InvalidRequest("O pedido não está no formato esperado.".into()))?;
    let note = query
        .note
        .map(|note| note.trim().to_owned())
        .filter(|note| !note.is_empty());
    if note
        .as_ref()
        .is_some_and(|note| note.chars().count() > logs::MAX_NOTE)
    {
        return Err(ApiError::InvalidRequest(format!(
            "Escreva até {} caracteres.",
            logs::MAX_NOTE
        )));
    }
    let now = now();
    if let Some(last) = logs::last_sent(&state.db, &user.id).await?
        && now - last < logs::MIN_GAP_SECS
    {
        return Err(ApiError::TooManyAttempts);
    }
    let bytes = axum::body::to_bytes(body, logs::MAX_SIZE)
        .await
        .map_err(|_| ApiError::InvalidRequest("Os logs passam de 10 MB.".into()))?;
    if !logs::is_zip(&bytes) {
        return Err(ApiError::InvalidRequest(
            "O arquivo não é um .zip de logs.".into(),
        ));
    }
    let version = headers
        .get("x-app-version")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 32)
        .unwrap_or("?");

    let id = logs::save(
        &state.db,
        &state.data_dir,
        &user.id,
        version,
        note.as_deref(),
        &bytes,
        now,
    )
    .await?;
    let report = logs::find(&state.db, &id).await?.ok_or_else(not_found)?;
    if let Some(owner) = users::find_owner(&state.db).await? {
        state.hub.publish_to(
            &[owner.id],
            &ServerEvent::LogsReceived {
                report: report.clone(),
            },
        );
    }
    Ok(Json(report))
}

/// `GET /api/logs`: os envios, do mais novo ao mais antigo. Só o dono.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<LogReportView>>, ApiError> {
    require_owner(&user)?;
    Ok(Json(logs::list(&state.db).await?))
}

/// `GET /api/logs/{id}`: o `.zip`. Só o dono.
pub async fn download(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    require_owner(&user)?;
    let report = logs::find(&state.db, &id).await?.ok_or_else(not_found)?;
    let bytes = logs::read(&state.data_dir, &report.id)
        .await
        .ok_or_else(not_found)?;
    let name = format!("ashtar-logs-{}-{}.zip", report.nick, report.created_at);
    let disposition = HeaderValue::from_str(&format!("attachment; filename=\"{name}\""))
        .unwrap_or_else(|_| HeaderValue::from_static("attachment"));
    Ok((
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/zip"),
            ),
            (header::CONTENT_DISPOSITION, disposition),
        ],
        bytes,
    )
        .into_response())
}
