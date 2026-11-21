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

/// `GET /api/files/{id}`: o arquivo, para quem pode ver (para os outros, 404). A imagem e o vídeo
/// com a assinatura certa vêm para mostrar; o resto, para baixar.
pub async fn download(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let not_found = || ApiError::NotFound("Esse arquivo não existe.".into());
    let file = files::find(&state.db, &id).await?.ok_or_else(not_found)?;
    if !files::can_read(&state.db, &user, &file).await? {
        return Err(not_found());
    }
    let handle = state.files.open(&file.id).await?;
    let length = handle.metadata().await?.len();
    let inline = file.inline();
    let content_type = if inline {
        file.mime.as_str()
    } else {
        "application/octet-stream"
    };
    let mut response = Body::from_stream(ReaderStream::new(handle)).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(content_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(header::CONTENT_LENGTH, HeaderValue::from(length));
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
