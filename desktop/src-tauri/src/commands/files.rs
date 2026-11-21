//! O Baixar dos arquivos do chat (ADR 0031). Espelhado em `lib/tauri/commands/files.ts`.

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use crate::api::download::{self, Progress};
use crate::api::ApiError;

/// Baixa o arquivo `id` para a pasta Downloads, com o nome `name` (ou o próximo livre), e devolve
/// o caminho. O progresso vai pelo `on_progress`. A recusa vem como o erro da API, no formato do
/// `apiFetch`.
#[tauri::command]
pub async fn file_download(
    app: AppHandle,
    id: String,
    name: String,
    token: String,
    on_progress: Channel<Progress>,
) -> Result<String, ApiError> {
    let dir = app
        .path()
        .download_dir()
        .map_err(|error| ApiError::app(format!("Não achei a pasta Downloads: {error}")))?;
    let version = app.package_info().version.to_string();
    let path = download::download(&id, &name, &token, &version, &dir, |progress| {
        let _ = on_progress.send(progress);
    })
    .await?;
    Ok(path.to_string_lossy().into_owned())
}
