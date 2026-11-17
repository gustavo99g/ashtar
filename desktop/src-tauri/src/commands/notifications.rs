//! Comandos dos avisos (`notifications.rs`): mostrar um cartão, posicionar a janela dos avisos,
//! abrir o que foi clicado e o ponto de não lido.
//!
//! O cartão e o alvo passam como JSON sem tipo: quem monta e quem lê é o frontend (as duas janelas
//! carregam o mesmo código, `features/notifications`), e o Rust só entrega.

use tauri::{AppHandle, Emitter};

use crate::error::AppError;
use crate::notifications::{self, LABEL, NOTIFICATION_CARD, NOTIFICATION_OPEN};
use crate::window::bring_to_front;

/// Leva um cartão à janela dos avisos. Devolve `false`, sem mostrar, quando o Windows pede
/// silêncio (tela cheia, apresentação, tela bloqueada).
#[tauri::command]
pub async fn notification_show(app: AppHandle, card: serde_json::Value) -> Result<bool, AppError> {
    if notifications::is_quiet() {
        tracing::info!("aviso segurado: o Windows pediu silêncio");
        return Ok(false);
    }
    app.emit_to(LABEL, NOTIFICATION_CARD, card)
        .map_err(|error| AppError::Internal(format!("aviso: {error}")))?;
    Ok(true)
}

/// A janela dos avisos diz a altura da pilha, em pixels lógicos; zero a esconde.
#[tauri::command]
pub async fn notification_layout(app: AppHandle, height: f64) -> Result<(), AppError> {
    notifications::place(&app, height)
        .map_err(|error| AppError::Internal(format!("janela dos avisos: {error}")))
}

/// Um cartão foi clicado: a janela principal vem para a frente e recebe o alvo.
#[tauri::command]
pub async fn notification_open(app: AppHandle, target: serde_json::Value) -> Result<(), AppError> {
    bring_to_front(&app);
    app.emit_to("main", NOTIFICATION_OPEN, target)
        .map_err(|error| AppError::Internal(format!("aviso: {error}")))
}

/// Liga ou desliga o ponto de não lido (a bolinha na bandeja e o selo na barra de tarefas).
#[tauri::command]
pub async fn set_unread_badge(app: AppHandle, unread: bool) -> Result<(), AppError> {
    notifications::set_badge(&app, unread);
    Ok(())
}
