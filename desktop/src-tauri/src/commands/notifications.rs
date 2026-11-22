//! Comandos dos avisos (`notifications.rs`): mostrar um cartão, posicionar a janela dos avisos,
//! abrir o que foi clicado e o ponto de não lido.
//!
//! O cartão e o alvo passam como JSON sem tipo: quem monta e quem lê é o frontend (as duas janelas
//! carregam o mesmo código, `features/notifications`), e o Rust só entrega.

use tauri::{AppHandle, Emitter};

use crate::error::AppError;
use crate::notifications::{
    self, LABEL, NOTIFICATION_ANSWER, NOTIFICATION_CARD, NOTIFICATION_OPEN, NOTIFICATION_RING,
};
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

/// Põe (ou tira, com `null`) o cartão da ligação recebida na janela dos avisos. Sem perguntar ao
/// Windows: a ligação toca mesmo com tela cheia (ADR 0023). Quem não quer ser chamado usa o
/// Ocupado, e aí o app nem manda o cartão.
#[tauri::command]
pub async fn notification_ring(app: AppHandle, card: serde_json::Value) -> Result<(), AppError> {
    app.emit_to(LABEL, NOTIFICATION_RING, card)
        .map_err(|error| AppError::Internal(format!("ligação: {error}")))
}

/// Um botão do cartão da ligação: a janela principal recebe a resposta. Atender e Responder com
/// mensagem trazem a janela para a frente; Recusar, não.
#[tauri::command]
pub async fn notification_answer(
    app: AppHandle,
    answer: serde_json::Value,
) -> Result<(), AppError> {
    if brings_to_front(&answer) {
        bring_to_front(&app);
    }
    app.emit_to("main", NOTIFICATION_ANSWER, answer)
        .map_err(|error| AppError::Internal(format!("ligação: {error}")))
}

/// Se a resposta pede a janela principal na frente: só o Atender e o Responder com mensagem.
fn brings_to_front(answer: &serde_json::Value) -> bool {
    matches!(
        answer.get("action").and_then(serde_json::Value::as_str),
        Some("accept" | "reply")
    )
}

/// Liga ou desliga o ponto de não lido (a bolinha na bandeja e o selo na barra de tarefas).
#[tauri::command]
pub async fn set_unread_badge(app: AppHandle, unread: bool) -> Result<(), AppError> {
    notifications::set_badge(&app, unread);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn so_atender_e_responder_trazem_a_janela() {
        assert!(brings_to_front(&json!({ "action": "accept" })));
        assert!(brings_to_front(&json!({ "action": "reply" })));
        assert!(!brings_to_front(&json!({ "action": "decline" })));
        assert!(!brings_to_front(&json!({})));
        assert!(!brings_to_front(&json!(null)));
    }
}
