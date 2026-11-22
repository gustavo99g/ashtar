//! O print da transmissão (decisões 22 a 24 do plano da v0.8): sempre para a área de
//! transferência, pelo Rust (aceita imagem grande e não depende do foco da janela), e, com "Salvar
//! prints no computador" ligado, também num PNG em `Imagens\Ashtar`.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::run_blocking;
use crate::error::AppError;
use crate::media::platform;
use crate::media::screenshot::{file_stem, free_path, Shot};
use crate::media::sources::SourceRef;

/// O que o aviso "Print copiado" mostra.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotDone {
    /// A miniatura, em `data:image/jpeg;base64,...`.
    pub thumbnail: String,
    /// Onde o arquivo ficou, se foi salvo.
    pub path: Option<String>,
}

/// A pasta dos prints: `Imagens\Ashtar`.
fn screenshot_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .picture_dir()
        .map(|dir| dir.join("Ashtar"))
        .map_err(|error| AppError::Internal(format!("sem a pasta Imagens: {error}")))
}

/// A janela principal, que o Windows pede como dona da área de transferência.
fn owner(app: &AppHandle) -> usize {
    #[cfg(windows)]
    if let Some(hwnd) = app
        .get_webview_window("main")
        .and_then(|window| window.hwnd().ok())
    {
        return hwnd.0 as usize;
    }
    #[cfg(not(windows))]
    let _ = app;
    0
}

/// Copia, salva se pedido e devolve a miniatura.
fn finish(
    shot: &Shot,
    owner: usize,
    dir: PathBuf,
    save_as: Option<String>,
) -> Result<ScreenshotDone, AppError> {
    let png = shot.png()?;
    platform::copy_image(owner, &shot.dib(), &png)?;
    let path = match save_as {
        Some(name) => {
            std::fs::create_dir_all(&dir)
                .map_err(|error| AppError::Internal(format!("pasta dos prints: {error}")))?;
            let path = free_path(&dir, &file_stem(&name));
            std::fs::write(&path, &png)
                .map_err(|error| AppError::Internal(format!("não deu para salvar: {error}")))?;
            Some(path.to_string_lossy().into_owned())
        }
        None => None,
    };
    Ok(ScreenshotDone {
        thumbnail: shot.thumbnail()?,
        path,
    })
}

/// O print da própria transmissão: a imagem atual da fonte, no tamanho cheio. `save_as` é o nome
/// do arquivo, sem a extensão, quando é para salvar.
#[tauri::command]
pub async fn screenshot_source(
    app: AppHandle,
    source: SourceRef,
    save_as: Option<String>,
) -> Result<ScreenshotDone, AppError> {
    let dir = screenshot_dir(&app)?;
    let owner = owner(&app);
    run_blocking(move || {
        let (bgra, width, height) = platform::capture_still(source)?;
        finish(&Shot::from_bgra(&bgra, width, height)?, owner, dir, save_as)
    })
    .await
}

/// O print da transmissão de outra pessoa: o PNG que o app tirou do `<video>`, em base64.
#[tauri::command]
pub async fn screenshot_image(
    app: AppHandle,
    png: String,
    save_as: Option<String>,
) -> Result<ScreenshotDone, AppError> {
    let dir = screenshot_dir(&app)?;
    let owner = owner(&app);
    run_blocking(move || finish(&Shot::from_png_base64(&png)?, owner, dir, save_as)).await
}

/// Abre `Imagens\Ashtar` no Explorador (o "Abrir pasta" do aviso e das configurações).
#[tauri::command]
pub async fn open_screenshot_dir(app: AppHandle) -> Result<(), AppError> {
    let dir = screenshot_dir(&app)?;
    run_blocking(move || {
        std::fs::create_dir_all(&dir)
            .map_err(|error| AppError::Internal(format!("pasta dos prints: {error}")))?;
        tauri_plugin_opener::open_path(&dir, None::<&str>)
            .map_err(|error| AppError::Internal(format!("não foi possível abrir a pasta: {error}")))
    })
    .await
}
