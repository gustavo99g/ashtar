//! O jogo aberto agora e Configurações › Atividade (ADR 0033). A lógica mora em `activity/`.

use std::sync::Arc;

use tauri::State;

use super::run_blocking;
use crate::activity::catalog::{DetectableGame, ManualGame};
use crate::activity::{Activity, GameView, SettingsView, WindowGame};
use crate::error::AppError;

type Shared<'a> = State<'a, Arc<Activity>>;

/// O jogo do cartão agora, ou `None`. Depois, cada mudança chega pelo `activity:changed`.
#[tauri::command]
pub async fn activity_state(activity: Shared<'_>) -> Result<Option<GameView>, AppError> {
    let activity = Arc::clone(&activity);
    run_blocking(move || Ok(activity.state())).await
}

#[tauri::command]
pub async fn activity_settings(activity: Shared<'_>) -> Result<SettingsView, AppError> {
    let activity = Arc::clone(&activity);
    run_blocking(move || Ok(activity.settings())).await
}

/// A chave geral "Mostrar o jogo detectado".
#[tauri::command]
pub async fn set_activity_enabled(activity: Shared<'_>, enabled: bool) -> Result<(), AppError> {
    let activity = Arc::clone(&activity);
    run_blocking(move || {
        Activity::set_enabled(&activity, enabled);
        Ok(())
    })
    .await
}

/// "Não mostrar para este jogo", e a chave da lista das configurações.
#[tauri::command]
pub async fn set_game_hidden(
    activity: Shared<'_>,
    id: String,
    hidden: bool,
) -> Result<(), AppError> {
    let activity = Arc::clone(&activity);
    run_blocking(move || {
        activity.set_hidden(&id, hidden);
        Ok(())
    })
    .await
}

/// Adiciona o `.exe` de uma janela da lista do seletor (`window_id` é o id dela).
#[tauri::command]
pub async fn add_game(
    activity: Shared<'_>,
    window_id: u64,
    name: String,
) -> Result<ManualGame, AppError> {
    let activity = Arc::clone(&activity);
    run_blocking(move || {
        activity
            .add_game(window_id, &name)
            .ok_or_else(|| AppError::Internal("a janela fechou ou o nome está vazio".into()))
    })
    .await
}

#[tauri::command]
pub async fn remove_game(activity: Shared<'_>, exe: String) -> Result<(), AppError> {
    let activity = Arc::clone(&activity);
    run_blocking(move || {
        activity.remove_game(&exe);
        Ok(())
    })
    .await
}

/// O `.exe` de cada janela e, se já for jogo, o nome (o "Adicionar jogo" apaga as reconhecidas).
#[tauri::command]
pub async fn activity_windows(
    activity: Shared<'_>,
    ids: Vec<u64>,
) -> Result<Vec<WindowGame>, AppError> {
    let activity = Arc::clone(&activity);
    run_blocking(move || Ok(activity.windows(&ids))).await
}

/// O `ETag` da cópia da lista de jogos, para o app pedir a lista nova com `If-None-Match`.
#[tauri::command]
pub async fn activity_detectable_etag(activity: Shared<'_>) -> Result<Option<String>, AppError> {
    Ok(activity.detectable_etag())
}

/// A lista de jogos detectáveis que o app buscou na API.
#[tauri::command]
pub async fn activity_set_detectable(
    activity: Shared<'_>,
    etag: String,
    games: Vec<DetectableGame>,
) -> Result<(), AppError> {
    let activity = Arc::clone(&activity);
    run_blocking(move || {
        activity.set_detectable(etag, games);
        Ok(())
    })
    .await
}
