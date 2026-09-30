//! Tipos do áudio do compartilhamento + entrada comum da captura.
//!
//! A implementação de verdade mora em `platform/<plataforma>/`. Este módulo define
//! o contrato, resolve os casos que não dependem de plataforma e escolhe a implementação.

use serde::Deserialize;

use super::{platform, AudioSink, CaptureHandle, OnEnd};
use crate::error::AppError;

/// O que o usuário escolheu capturar de áudio junto com a tela (vem do frontend).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(
    tag = "mode",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AudioMode {
    Off,
    Application { process_id: u32 },
    System,
}

/// O que a plataforma deve capturar. Diferente do `AudioMode`, não tem `Off`:
/// a plataforma nunca recebe um pedido para "capturar nada".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioTarget {
    Process(u32),
    SystemExcept(u32),
}

/// Inicia a captura do áudio escolhido, entregando as amostras ao `sink`.
///
/// Devolve `Ok(None)` para `AudioMode::Off`, sem criar thread nem chamar o `on_end`.
///
/// # Bloqueia
///
/// Espera a captura inicializar. Só chamar dentro de `spawn_blocking`.
pub fn spawn_audio_capture(
    mode: AudioMode,
    sink: impl AudioSink,
    on_end: OnEnd,
) -> Result<Option<CaptureHandle>, AppError> {
    let own_pid = std::process::id();

    let target = match mode {
        AudioMode::Off => return Ok(None),
        AudioMode::Application { process_id } if process_id == own_pid => {
            return Err(AppError::AudioCapture(
                "Não é possível capturar o áudio do próprio app".into(),
            ));
        }
        AudioMode::Application { process_id } => AudioTarget::Process(process_id),
        AudioMode::System => AudioTarget::SystemExcept(own_pid),
    };
    platform::spawn_audio_capture(target, sink, on_end).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::diagnostics::LogAudioSink;
    use crate::media::EndReason;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use std::time::Duration;

    /// Liga os logs dentro dos testes. Sem isso, os relatórios do sink não aparecem.
    fn init_test_logs() {
        let _ = tracing_subscriber::fmt()
            .with_env_filter(tracing_subscriber::EnvFilter::new("info,perf=debug"))
            .with_test_writer()
            .try_init();
    }

    fn capture_for(mode: AudioMode, seconds: u64) {
        init_test_logs();

        let (tx, rx) = std::sync::mpsc::channel();
        let handle = spawn_audio_capture(
            mode,
            LogAudioSink::new(),
            Box::new(move |reason| {
                let _ = tx.send(reason);
            }),
        )
        .expect("a captura deveria iniciar")
        .expect("esse modo deveria criar uma captura");

        std::thread::sleep(Duration::from_secs(seconds));
        handle.stop_and_join();

        let reason = rx
            .recv_timeout(Duration::from_secs(1))
            .expect("o on_end deveria ter sido chamado");
        assert!(
            matches!(reason, EndReason::Stopped),
            "motivo inesperado: {reason:?}"
        );
    }

    #[test]
    fn off_nao_inicia_nada() {
        let called = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&called);

        let result = spawn_audio_capture(
            AudioMode::Off,
            LogAudioSink::new(),
            Box::new(move |_| flag.store(true, Ordering::SeqCst)),
        );

        assert!(matches!(result, Ok(None)));
        assert!(
            !called.load(Ordering::SeqCst),
            "o on_end não deveria ser chamado"
        );
    }

    #[test]
    fn recusa_capturar_o_proprio_app() {
        let mode = AudioMode::Application {
            process_id: std::process::id(),
        };
        let result = spawn_audio_capture(mode, LogAudioSink::new(), Box::new(|_| {}));
        assert!(matches!(result, Err(AppError::AudioCapture(_))));
    }

    #[test]
    fn le_o_formato_enviado_pelo_frontend() {
        let mode: AudioMode =
            serde_json::from_str(r#"{"mode":"application","processId":123}"#).unwrap();
        assert_eq!(mode, AudioMode::Application { process_id: 123 });

        let mode: AudioMode = serde_json::from_str(r#"{"mode":"system"}"#).unwrap();
        assert_eq!(mode, AudioMode::System);

        let mode: AudioMode = serde_json::from_str(r#"{"mode":"off"}"#).unwrap();
        assert_eq!(mode, AudioMode::Off);
    }

    #[test]
    #[ignore = "precisa de áudio tocando no computador"]
    fn captura_o_sistema() {
        capture_for(AudioMode::System, 10);
    }

    #[test]
    #[ignore = "precisa de CAPTURE_PID com o PID de um programa tocando áudio"]
    fn captura_um_aplicativo() {
        let pid: u32 = std::env::var("CAPTURE_PID")
            .expect("defina a variável CAPTURE_PID")
            .parse()
            .expect("CAPTURE_PID deve ser um número");
        capture_for(AudioMode::Application { process_id: pid }, 10);
    }
}
