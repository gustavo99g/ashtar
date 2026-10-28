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
    let webview_pid = crate::webview_process::browser_pid();
    let Some(target) = audio_target(mode, own_pid, webview_pid)? else {
        return Ok(None);
    };
    platform::spawn_audio_capture(target, sink, on_end).map(Some)
}

/// Traduz o pedido do usuário no que a plataforma captura. `None` é "sem áudio".
///
/// Na tela inteira, exclui o processo-navegador do WebView2 (`webview_pid`), que toca a voz do
/// grupo, e só cai no do app quando ele não é conhecido (`webview_process.rs`).
fn audio_target(
    mode: AudioMode,
    own_pid: u32,
    webview_pid: Option<u32>,
) -> Result<Option<AudioTarget>, AppError> {
    match mode {
        AudioMode::Off => Ok(None),
        AudioMode::Application { process_id } if process_id == own_pid => Err(
            AppError::AudioCapture("Não é possível capturar o áudio do próprio app".into()),
        ),
        AudioMode::Application { process_id } => Ok(Some(AudioTarget::Process(process_id))),
        AudioMode::System => Ok(Some(AudioTarget::SystemExcept(
            crate::webview_process::exclude_target(own_pid, webview_pid),
        ))),
    }
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

    #[test]
    fn tela_inteira_exclui_o_webview_e_so_cai_no_app_sem_ele() {
        assert_eq!(
            audio_target(AudioMode::System, 100, Some(200)).unwrap(),
            Some(AudioTarget::SystemExcept(200))
        );
        assert_eq!(
            audio_target(AudioMode::System, 100, None).unwrap(),
            Some(AudioTarget::SystemExcept(100))
        );
    }

    #[test]
    fn janela_e_sem_audio_nao_mudam() {
        assert_eq!(audio_target(AudioMode::Off, 100, Some(200)).unwrap(), None);
        assert_eq!(
            audio_target(AudioMode::Application { process_id: 7 }, 100, Some(200)).unwrap(),
            Some(AudioTarget::Process(7))
        );
        assert!(audio_target(AudioMode::Application { process_id: 100 }, 100, Some(200)).is_err());
    }

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

    /// Mede o nível (RMS) do que o loopback entrega para um alvo, para comparar exclusão e inclusão.
    struct RmsSink(Arc<std::sync::Mutex<(f64, u64)>>);

    impl AudioSink for RmsSink {
        fn push(&mut self, samples: &[f32]) -> crate::media::SinkStatus {
            let mut guard = self.0.lock().unwrap();
            for s in samples {
                guard.0 += f64::from(*s) * f64::from(*s);
            }
            guard.1 += samples.len() as u64;
            crate::media::SinkStatus::Continue
        }
    }

    fn rms_for(target: AudioTarget, seconds: u64) -> f64 {
        let acc = Arc::new(std::sync::Mutex::new((0.0_f64, 0_u64)));
        let handle =
            platform::spawn_audio_capture(target, RmsSink(Arc::clone(&acc)), Box::new(|_| {}))
                .expect("a captura deveria iniciar");
        std::thread::sleep(Duration::from_secs(seconds));
        handle.stop_and_join();
        let (sum, n) = *acc.lock().unwrap();
        if n == 0 {
            0.0
        } else {
            (sum / n as f64).sqrt()
        }
    }

    /// Confere se excluir a raiz de um Chromium tira o áudio dele do loopback do sistema.
    ///
    /// Como rodar: abra um Chromium (ou o app) tocando áudio, ache o PID do processo raiz (o
    /// `browser`, sem `--type=` na linha de comando) e rode com `EXCLUDE_PID=<pid>`. Vale a
    /// comparação: "tudo menos o Chromium" deve ficar perto do ruído de fundo, bem abaixo de
    /// "tudo menos este teste", que inclui o Chromium. O PID inexistente `99999` mede só o fundo.
    #[test]
    #[ignore = "diagnóstico: precisa de EXCLUDE_PID (raiz de um Chromium tocando áudio)"]
    fn mede_a_exclusao_de_um_chromium() {
        let pid: u32 = std::env::var("EXCLUDE_PID").unwrap().parse().unwrap();
        let own = std::process::id();
        let todos_menos_o_chromium = rms_for(AudioTarget::SystemExcept(pid), 5);
        let todos_menos_este_teste = rms_for(AudioTarget::SystemExcept(own), 5);
        let so_o_chromium = rms_for(AudioTarget::Process(pid), 5);
        println!("RMS tudo menos o Chromium ({pid}): {todos_menos_o_chromium:.5}");
        println!("RMS tudo menos este teste ({own}):  {todos_menos_este_teste:.5}");
        println!("RMS so o Chromium ({pid}):          {so_o_chromium:.5}");
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
