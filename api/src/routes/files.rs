//! Os arquivos (ADR 0031): o envio e a leitura. O envio é o corpo cru, gravado em pedaços direto
//! no disco; a leitura confere quem pode ver e devolve com o nome original.

use axum::Json;
use axum::body::Body;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use futures_util::StreamExt;
use serde::Deserialize;
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use super::auth::CurrentUser;
use crate::AppState;
use crate::db::now;
use crate::error::ApiError;
use crate::files::{self, FileKind, FileView, NewFile};
use crate::routes::admin;

#[derive(Debug, Deserialize)]
pub struct UploadQuery {
    pub kind: FileKind,
    /// O nome original ("print.png").
    pub name: String,
    /// As dimensões e a duração, que o app mede antes de enviar (a API não decodifica).
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    /// A miniatura deste arquivo, enviada antes por quem envia este.
    pub thumbnail: Option<String>,
}

/// Quanto do começo do arquivo a API guarda para conferir a assinatura.
const HEAD_BYTES: usize = 16;

/// `POST /api/files?kind=attachment&name=...`: o corpo é o arquivo, e o `Content-Type`, o tipo.
/// Responde 201 com o [`FileView`]. Passou do tamanho do tipo, 413 (sem ler o resto); com menos de
/// 1 GB livre no disco, 507. A prévia de link quem grava é a API: esse tipo é recusado.
pub async fn upload(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    headers: HeaderMap,
    query: Result<Query<UploadQuery>, QueryRejection>,
    body: Body,
) -> Result<(StatusCode, Json<FileView>), ApiError> {
    let Query(query) = query
        .map_err(|_| ApiError::InvalidRequest("O pedido não está no formato esperado.".into()))?;
    if query.kind == FileKind::Preview {
        return Err(ApiError::InvalidRequest(
            "Esse tipo de arquivo não se envia.".into(),
        ));
    }
    let name = files::clean_name(&query.name)
        .ok_or_else(|| ApiError::InvalidRequest("O arquivo precisa de um nome.".into()))?;
    let dimension = |value: Option<i64>| match value {
        None => Ok(None),
        Some(v) if (1..=100_000).contains(&v) => Ok(Some(v)),
        Some(_) => Err(ApiError::InvalidRequest(
            "As dimensões não estão no formato esperado.".into(),
        )),
    };
    let width = dimension(query.width)?;
    let height = dimension(query.height)?;
    let duration_ms = match query.duration_ms {
        None => None,
        Some(d) if (0..=24 * 3600 * 1000).contains(&d) => Some(d),
        Some(_) => {
            return Err(ApiError::InvalidRequest(
                "A duração não está no formato esperado.".into(),
            ));
        }
    };
    if let Some(thumbnail) = &query.thumbnail {
        let found = files::find(&state.db, thumbnail).await?;
        let ok = found.is_some_and(|t| {
            t.uploader_id == user.id && t.kind == query.kind && t.mime.starts_with("image/")
        });
        if !ok {
            return Err(ApiError::InvalidRequest("A miniatura não vale.".into()));
        }
    }
    let (max, max_label) = query.kind.max_size();
    if let Some(length) = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        && length > max
    {
        return Err(ApiError::FileTooLarge(max_label));
    }
    if admin::disk(state.files.root())
        .or_else(|| admin::disk(&state.data_dir))
        .is_some_and(|disk| disk.free_bytes < files::MIN_FREE_BYTES)
    {
        return Err(ApiError::DiskFull);
    }

    let id = Uuid::now_v7().to_string();
    let mut upload = state.files.put(&id).await?;
    let mut head: Vec<u8> = Vec::with_capacity(HEAD_BYTES);
    let mut size: u64 = 0;
    let mut stream = body.into_data_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| {
            ApiError::InvalidRequest("O envio parou no meio. Tente de novo.".into())
        })?;
        size += chunk.len() as u64;
        if size > max {
            // O `upload` sai daqui e apaga o que foi gravado.
            return Err(ApiError::FileTooLarge(max_label));
        }
        if head.len() < HEAD_BYTES {
            let take = (HEAD_BYTES - head.len()).min(chunk.len());
            head.extend_from_slice(&chunk[..take]);
        }
        upload.write(&chunk).await?;
    }
    if size == 0 {
        return Err(ApiError::InvalidRequest("O arquivo está vazio.".into()));
    }
    upload.finish().await?;

    let claimed = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let mime = files::settle_mime(claimed, &head);
    // As dimensões só valem para o que o app mostra.
    let media = files::is_media(&mime);
    let record = NewFile {
        id: id.clone(),
        uploader_id: user.id.clone(),
        kind: query.kind,
        name,
        mime,
        size: size as i64,
        width: width.filter(|_| media),
        height: height.filter(|_| media),
        duration_ms: duration_ms.filter(|_| media),
        thumbnail_id: query.thumbnail,
        created_at: now(),
    };
    if let Err(error) = files::insert(&state.db, &record).await {
        let _ = state.files.delete(&id).await;
        return Err(error);
    }
    let saved = files::find(&state.db, &id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Esse arquivo não existe.".into()))?;
    Ok((StatusCode::CREATED, Json(saved.view())))
}

/// O `Content-Disposition` com o nome original (`filename*` em UTF-8, e um `filename` ASCII para
/// quem não entende o outro).
fn disposition(inline: bool, name: &str) -> HeaderValue {
    let ascii: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_graphic() && c != '"' && c != '\\' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let encoded: String = name
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    let kind = if inline { "inline" } else { "attachment" };
    HeaderValue::from_str(&format!(
        "{kind}; filename=\"{ascii}\"; filename*=UTF-8''{encoded}"
    ))
    .unwrap_or_else(|_| HeaderValue::from_static("attachment"))
}

/// `GET /api/files/{id}`: o arquivo, se quem pede pode ver (senão 404, como se não existisse).
/// Aceita `Range` (um pedaço só), para o vídeo começar sem baixar tudo.
pub async fn download(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let not_found = || ApiError::NotFound("Esse arquivo não existe.".into());
    let file = files::find(&state.db, &id).await?.ok_or_else(not_found)?;
    if !files::can_read(&state.db, &user, &file).await? {
        return Err(not_found());
    }
    serve(&state, &file, &headers).await
}

/// Quanto tempo vale o link do vídeo, em segundos.
pub const LINK_SECS: i64 = 10 * 60;

/// O link curto do vídeo: o `<video>` não manda o cabeçalho do token.
#[derive(Debug, serde::Serialize, ts_rs::TS)]
#[ts(export, export_to = "index.ts")]
pub struct FileLink {
    /// O caminho na API (`/api/files/{id}/stream?...`), sem o endereço.
    pub path: String,
    pub expires_at: i64,
}

/// `POST /api/files/{id}/link`: um link que vale 10 minutos só para este arquivo, sem o token
/// (decisão 28 do plano da v0.7). Só para vídeo; o resto vai pelo `GET` com o token.
pub async fn link(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<FileLink>, ApiError> {
    let not_found = || ApiError::NotFound("Esse arquivo não existe.".into());
    let file = files::find(&state.db, &id).await?.ok_or_else(not_found)?;
    if !files::can_read(&state.db, &user, &file).await? {
        return Err(not_found());
    }
    if !files::is_video(&file.mime) {
        return Err(ApiError::InvalidRequest("Só o vídeo ganha link.".into()));
    }
    let expires_at = now() + LINK_SECS;
    let sig = files::sign_link(state.link_key.as_slice(), &file.id, expires_at);
    Ok(Json(FileLink {
        path: format!("/api/files/{}/stream?exp={expires_at}&sig={sig}", file.id),
        expires_at,
    }))
}

#[derive(Debug, Deserialize)]
pub struct StreamQuery {
    pub exp: i64,
    pub sig: String,
}

/// `GET /api/files/{id}/stream?exp=...&sig=...`: o vídeo pelo link curto, sem o token. Link
/// vencido ou de outro arquivo: 404.
pub async fn stream(
    State(state): State<AppState>,
    Path(id): Path<String>,
    query: Result<Query<StreamQuery>, QueryRejection>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let not_found = || ApiError::NotFound("Esse arquivo não existe.".into());
    let Ok(Query(query)) = query else {
        return Err(not_found());
    };
    if query.exp < now()
        || query.exp > now() + LINK_SECS
        || !files::link_matches(state.link_key.as_slice(), &id, query.exp, &query.sig)
    {
        return Err(not_found());
    }
    let file = files::find(&state.db, &id).await?.ok_or_else(not_found)?;
    if !files::is_video(&file.mime) {
        return Err(not_found());
    }
    serve(&state, &file, &headers).await
}

/// O `Range` pede um pedaço fora do arquivo (416).
#[derive(Debug, PartialEq, Eq)]
pub struct OutOfRange;

/// O pedaço pedido no `Range` (`bytes=início-fim`, `bytes=início-` ou `bytes=-últimos`), de um
/// arquivo de `length` bytes: `Ok(None)` sem `Range` (ou com um que não entendemos, como vários
/// pedaços: vai o arquivo inteiro), `Err` se o pedaço está fora do arquivo (416).
pub fn requested_range(value: Option<&str>, length: u64) -> Result<Option<(u64, u64)>, OutOfRange> {
    let Some(spec) = value.and_then(|v| v.trim().strip_prefix("bytes=")) else {
        return Ok(None);
    };
    if spec.contains(',') {
        return Ok(None);
    }
    let Some((start, end)) = spec.split_once('-') else {
        return Ok(None);
    };
    let (start, end) = match (start.trim(), end.trim()) {
        ("", "") => return Ok(None),
        ("", last) => {
            let last: u64 = last.parse().map_err(|_| OutOfRange)?;
            if last == 0 || length == 0 {
                return Err(OutOfRange);
            }
            (length.saturating_sub(last), length - 1)
        }
        (start, "") => (
            start.parse().map_err(|_| OutOfRange)?,
            length.saturating_sub(1),
        ),
        (start, end) => {
            let start: u64 = start.parse().map_err(|_| OutOfRange)?;
            let end: u64 = end.parse().map_err(|_| OutOfRange)?;
            (start, end.min(length.saturating_sub(1)))
        }
    };
    if start >= length || start > end {
        return Err(OutOfRange);
    }
    Ok(Some((start, end)))
}

/// Manda o arquivo (ou o pedaço do `Range`), com o tipo, o nome e o cache.
async fn serve(
    state: &AppState,
    file: &files::FileRecord,
    request: &HeaderMap,
) -> Result<Response, ApiError> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};

    let mut handle = state.files.open(&file.id).await?;
    let length = handle.metadata().await?.len();
    let range = request.get(header::RANGE).and_then(|v| v.to_str().ok());
    let range = match requested_range(range, length) {
        Ok(range) => range,
        Err(OutOfRange) => {
            let mut response = StatusCode::RANGE_NOT_SATISFIABLE.into_response();
            if let Ok(value) = HeaderValue::from_str(&format!("bytes */{length}")) {
                response.headers_mut().insert(header::CONTENT_RANGE, value);
            }
            return Ok(response);
        }
    };
    let inline = file.inline();
    let content_type = if inline {
        file.mime.as_str()
    } else {
        "application/octet-stream"
    };
    let mut response = match range {
        Some((start, end)) => {
            handle.seek(std::io::SeekFrom::Start(start)).await?;
            let part = handle.take(end - start + 1);
            let mut response = Body::from_stream(ReaderStream::new(part)).into_response();
            *response.status_mut() = StatusCode::PARTIAL_CONTENT;
            let headers = response.headers_mut();
            headers.insert(header::CONTENT_LENGTH, HeaderValue::from(end - start + 1));
            if let Ok(value) = HeaderValue::from_str(&format!("bytes {start}-{end}/{length}")) {
                headers.insert(header::CONTENT_RANGE, value);
            }
            response
        }
        None => {
            let mut response = Body::from_stream(ReaderStream::new(handle)).into_response();
            response
                .headers_mut()
                .insert(header::CONTENT_LENGTH, HeaderValue::from(length));
            response
        }
    };
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(content_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers.insert(header::CONTENT_DISPOSITION, disposition(inline, &file.name));
    // O id nunca muda de conteúdo: pode guardar, mas só para quem pediu.
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=31536000, immutable"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn o_range() {
        assert_eq!(requested_range(None, 100), Ok(None));
        assert_eq!(requested_range(Some("bytes=0-9"), 100), Ok(Some((0, 9))));
        assert_eq!(requested_range(Some("bytes=90-"), 100), Ok(Some((90, 99))));
        assert_eq!(requested_range(Some("bytes=-10"), 100), Ok(Some((90, 99))));
        assert_eq!(
            requested_range(Some("bytes=50-500"), 100),
            Ok(Some((50, 99)))
        );
        assert_eq!(requested_range(Some("bytes=0-1,5-6"), 100), Ok(None));
        assert_eq!(requested_range(Some("bytes=100-"), 100), Err(OutOfRange));
        assert_eq!(requested_range(Some("bytes=9-3"), 100), Err(OutOfRange));
        assert_eq!(requested_range(Some("bytes=a-"), 100), Err(OutOfRange));
    }

    #[test]
    fn o_nome_vai_nos_dois_formatos() {
        assert_eq!(
            disposition(false, "relatório final.pdf"),
            "attachment; filename=\"relat_rio final.pdf\"; filename*=UTF-8''relat%C3%B3rio%20final.pdf"
        );
        assert_eq!(
            disposition(true, "a\"b.png"),
            "inline; filename=\"a_b.png\"; filename*=UTF-8''a%22b.png"
        );
    }
}
