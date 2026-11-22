//! Comandos Tauri: a fronteira entre o React e o núcleo Rust.
//!
//! Cada arquivo agrupa os comandos de um assunto. Regras para todos:
//!
//! - todo comando é `async` e devolve `Result<_, AppError>`, menos o `login` e o `redeem`
//!   (`identity.rs`), que falam com a API e devolvem o erro dela (`api::ApiError`);
//! - trabalho que bloqueia (enumeração de fontes, início e fim de captura)
//!   roda em [`run_blocking`], nunca direto no corpo do comando;
//! - comandos só traduzem: validam a entrada, chamam `media::` e convertem o
//!   resultado. Lógica de captura e de sessão não mora aqui.

pub mod activity;
pub mod app;
pub mod files;
pub mod identity;
pub mod notifications;
pub mod presence;
pub mod screen_share;
pub mod screenshot;
pub mod shortcuts;
pub mod thumbnails;
pub mod updater;

use crate::error::AppError;

/// Roda `f` no pool de threads de bloqueio do Tauri e devolve o resultado.
///
/// Um panic dentro de `f` vira `AppError::Internal`, em vez de o comando
/// morrer sem resposta para o frontend.
pub async fn run_blocking<T, F>(f: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Internal(format!("a tarefa em segundo plano falhou: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn devolve_o_resultado_da_tarefa() {
        let result = tauri::async_runtime::block_on(run_blocking(|| Ok(42)));
        assert_eq!(result.unwrap(), 42);
    }

    #[test]
    fn panic_na_tarefa_vira_erro_interno() {
        let result: Result<(), AppError> =
            tauri::async_runtime::block_on(run_blocking(|| panic!("falha de teste")));
        assert!(matches!(result, Err(AppError::Internal(_))));
    }
}
