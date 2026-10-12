//! Comandos sobre o próprio app (versão, novidades).

use serde::Serialize;
use tauri::AppHandle;

use crate::changelog;
use crate::error::AppError;

#[derive(Debug, Clone, Serialize)]
pub struct WhatsNew {
    pub version: String,
    /// A seção do `CHANGELOG.md`, em Markdown simples (linhas com `- `).
    pub notes: String,
}

/// A seção do `CHANGELOG.md` da versão em execução, ou `None` se ela não existe.
#[tauri::command]
pub async fn whats_new(app: AppHandle) -> Result<Option<WhatsNew>, AppError> {
    let version = app.package_info().version.to_string();
    Ok(changelog::for_version(&version).map(|notes| WhatsNew { version, notes }))
}
