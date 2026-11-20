//! Comandos sobre o próprio app (versão, novidades, pasta de logs, menu da bandeja, iniciar com o
//! Windows).

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

use crate::changelog;
use crate::commands::run_blocking;
use crate::error::AppError;
use crate::log_bundle;
use crate::tray;

#[derive(Debug, Clone, Serialize)]
pub struct WhatsNew {
    /// A versão instalada.
    pub version: String,
    /// As seções a mostrar, da mais nova para a mais velha: só a instalada, ou também as que a
    /// pessoa pulou desde a última vista.
    pub sections: Vec<ReleaseNotes>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReleaseNotes {
    pub version: String,
    /// A seção do `CHANGELOG.md`, em Markdown simples (linhas com `- `).
    pub notes: String,
}

/// Mostra (ou tira) as opções da transmissão no menu da bandeja. `sharing` falso tira; `paused`
/// escolhe entre "Pausar" e "Continuar".
#[tauri::command]
pub async fn tray_share_state(app: AppHandle, sharing: bool, paused: bool) -> Result<(), AppError> {
    tray::set_share(&app, sharing.then_some(paused));
    Ok(())
}

/// Se o app inicia com o Windows (a chave de Configurações › Aplicativo).
#[tauri::command]
pub async fn autostart_enabled(app: AppHandle) -> Result<bool, AppError> {
    app.autolaunch()
        .is_enabled()
        .map_err(|error| AppError::Internal(format!("iniciar com o Windows: {error}")))
}

/// Liga ou desliga o iniciar com o Windows. Ligado, o Windows abre o app com `--tray`, e ele sobe
/// direto na bandeja (`lib.rs`).
#[tauri::command]
pub async fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), AppError> {
    let autostart = app.autolaunch();
    let result = if enabled {
        autostart.enable()
    } else {
        autostart.disable()
    };
    result.map_err(|error| AppError::Internal(format!("iniciar com o Windows: {error}")))?;
    tracing::info!(enabled, "iniciar com o Windows");
    Ok(())
}

/// As seções do `CHANGELOG.md` depois de `last_seen` até a versão em execução (quem pulou
/// versões vê todas), ou só a da versão em execução sem `last_seen`. `None` se não há nenhuma.
#[tauri::command]
pub async fn whats_new(
    app: AppHandle,
    last_seen: Option<String>,
) -> Result<Option<WhatsNew>, AppError> {
    let version = app.package_info().version.to_string();
    let sections: Vec<ReleaseNotes> = changelog::since(last_seen.as_deref(), &version)
        .into_iter()
        .map(|(version, notes)| ReleaseNotes { version, notes })
        .collect();
    Ok((!sections.is_empty()).then_some(WhatsNew { version, sections }))
}

/// Junta os logs dos últimos 2 dias e o `info.txt` num `.zip` ("Enviar logs", v0.6). Volta os
/// bytes crus (um `ArrayBuffer` no JavaScript), que o app manda para a API.
#[tauri::command]
pub async fn logs_bundle(app: AppHandle) -> Result<tauri::ipc::Response, AppError> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|error| AppError::Internal(format!("sem a pasta de logs: {error}")))?;
    let version = app.package_info().version.to_string();
    let bytes = run_blocking(move || {
        let info = log_bundle::info(
            &version,
            log_bundle::windows_version(),
            crate::media::video::gpu_name(),
        );
        log_bundle::bundle(&dir, std::time::SystemTime::now(), &info)
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Abre a pasta de logs no Explorador de Arquivos ("Abrir pasta" na tela
/// Aplicativo), para a pessoa mandar os arquivos ao dono.
///
/// É um comando porque a permissão `opener:default` só deixa o JavaScript
/// abrir links e mostrar um arquivo na pasta dele; abrir uma pasta pediria o
/// `opener:allow-open-path` com um escopo de caminhos. Daqui, a função do
/// `tauri-plugin-opener` abre só este caminho, e o frontend não escolhe qual.
#[tauri::command]
pub async fn open_log_dir(app: AppHandle) -> Result<(), AppError> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|error| AppError::Internal(format!("sem a pasta de logs: {error}")))?;
    run_blocking(move || {
        // O `logging` já criou a pasta ao abrir, mas o Explorador não abre uma
        // pasta que não existe.
        std::fs::create_dir_all(&dir)
            .map_err(|error| AppError::Internal(format!("pasta de logs: {error}")))?;
        tauri_plugin_opener::open_path(&dir, None::<&str>).map_err(|error| {
            AppError::Internal(format!("não foi possível abrir a pasta de logs: {error}"))
        })
    })
    .await
}
