//! Comandos do compartilhamento de tela (Etapa 4 do `PLAN.md`).
//!
//! O prefixo `ipc_` marca o que é específico do caminho atual (frames pelo
//! IPC do Tauri). `list_capture_sources`, `screen_share_stop` e os eventos de
//! fim também vão servir ao publicador nativo.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    AppHandle, Emitter, State,
};
use tracing::{info, warn};

use crate::{
    error::AppError,
    media::{
        audio::AudioMode,
        ipc_sink::{IpcAudioSink, IpcVideoSink},
        quality::Quality,
        session::{ScreenShareManager, ShareEvent},
        sources::{self, CaptureSource, SourceRef},
        video_capture::VideoCaptureConfig,
        EndReason, FrameGate,
    },
};

use super::run_blocking;

/// O que o frontend escolheu no seletor (argumento de `ipc_screen_share_start`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartOptions {
    pub source: SourceRef,
    pub quality: Quality,
    pub audio: AudioMode,
}

/// Nome do evento de fim da sessão (contrato com o frontend, `PLAN.md` 4.2).
pub const SCREEN_SHARE_ENDED: &str = "screen-share-ended";
/// Nome do evento de fim só do áudio (contrato com o frontend, `PLAN.md` 4.2).
pub const SCREEN_SHARE_AUDIO_ENDED: &str = "screen-share-audio-ended";

/// Motivo do fim, como o frontend recebe.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EndedReason {
    Stopped,
    SourceClosed,
    Error,
}

/// Payload de `screen-share-ended` e `screen-share-audio-ended`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareEndedPayload {
    pub session_id: u64,
    pub reason: EndedReason,
    /// Só em `Error`: a descrição do que falhou.
    pub message: Option<String>,
}

impl ShareEndedPayload {
    fn new(session_id: u64, reason: EndReason) -> Self {
        let (reason, message) = match reason {
            EndReason::Stopped => (EndedReason::Stopped, None),
            EndReason::SourceClosed => (EndedReason::SourceClosed, None),
            EndReason::Error(message) => (EndedReason::Error, Some(message)),
        };

        Self {
            session_id,
            reason,
            message,
        }
    }
}

/// Traduz um evento do manager para o evento Tauri correspondente.
fn emit_share_event(app: &AppHandle, event: ShareEvent) {
    let (name, payload) = match event {
        ShareEvent::Ended { session_id, reason } => (
            SCREEN_SHARE_ENDED,
            ShareEndedPayload::new(session_id, reason),
        ),
        ShareEvent::AudioEnded { session_id, reason } => (
            SCREEN_SHARE_AUDIO_ENDED,
            ShareEndedPayload::new(session_id, reason),
        ),
    };

    info!(
        event = name,
        session_id = payload.session_id,
        reason = ?payload.reason,
        "emitindo fim do compartilhamento"
    );

    if let Err(error) = app.emit(name, payload) {
        warn!(event = name, %error, "falha ao emitir evento para o frontend");
    }
}

/// Cria o manager do compartilhamento, ligado aos eventos do Tauri.
/// Chamado uma vez, no `setup` do app.
pub fn create_manager(app: &AppHandle) -> Arc<ScreenShareManager> {
    let app = app.clone();
    Arc::new(ScreenShareManager::new(move |event| {
        emit_share_event(&app, event);
    }))
}

// ============================================================================
// Comandos
// ============================================================================

/// Lista as janelas e telas que dá para compartilhar, com título, ícone e geometria.
///
/// A enumeração e a extração de ícones bloqueiam, por isso rodam em [`run_blocking`].
#[tauri::command]
pub async fn list_capture_sources() -> Result<Vec<CaptureSource>, AppError> {
    run_blocking(sources::list_capture_sources).await
}

/// Inicia um compartilhamento pelo caminho IPC. Só responde depois que o
/// vídeo e, se pedido, o áudio inicializaram (início atômico, decisão 6).
#[tauri::command]
pub async fn ipc_screen_share_start(
    manager: State<'_, Arc<ScreenShareManager>>,
    options: StartOptions,
    video: Channel<InvokeResponseBody>,
    audio: Channel<InvokeResponseBody>,
) -> Result<u64, AppError> {
    let manager = Arc::clone(manager.inner());
    let preset = options.quality.preset();

    let video_config = VideoCaptureConfig {
        source: options.source,
        max_width: preset.max_width,
        max_height: preset.max_height,
        fps: preset.fps,
    };

    let video_sink = IpcVideoSink::new(video, FrameGate::new(preset.max_in_flight));
    let audio_sink = IpcAudioSink::new(audio);

    run_blocking(move || manager.start(video_config, video_sink, options.audio, audio_sink)).await
}

/// Confirma que o frontend terminou de processar um frame (libera o `FrameGate`).
/// Ids de sessões encerradas são ignorados: frames em trânsito ainda geram ACKs.
#[tauri::command]
pub async fn ipc_screen_share_ack(
    manager: State<'_, Arc<ScreenShareManager>>,
    session_id: u64,
) -> Result<(), AppError> {
    manager.ack(session_id);
    Ok(())
}

/// Encerra o compartilhamento. Idempotente: um id que já acabou não é erro.
#[tauri::command]
pub async fn screen_share_stop(
    manager: State<'_, Arc<ScreenShareManager>>,
    session_id: u64,
) -> Result<(), AppError> {
    let manager = Arc::clone(manager.inner());
    run_blocking(move || manager.stop(session_id)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_as_opcoes_enviadas_pelo_frontend() {
        let json = r#"{
            "source": { "kind": "window", "id": 123 },
            "quality": "720p60",
            "audio": { "mode": "application", "processId": 456 }
        }"#;

        let options: StartOptions = serde_json::from_str(json).unwrap();
        assert_eq!(
            options,
            StartOptions {
                source: SourceRef::Window(123),
                quality: Quality::Motion,
                audio: AudioMode::Application { process_id: 456 },
            }
        );
    }

    #[test]
    fn recusa_campo_desconhecido() {
        let json = r#"{
            "source": { "kind": "monitor", "id": 0 },
            "quality": "1080p30",
            "audio": { "mode": "off" },
            "fps": 60
        }"#;

        assert!(serde_json::from_str::<StartOptions>(json).is_err());
    }

    #[test]
    fn payload_no_formato_do_frontend() {
        let payload = ShareEndedPayload::new(7, EndReason::Error("a janela sumiu".into()));
        assert_eq!(
            serde_json::to_value(&payload).unwrap(),
            serde_json::json!({ "sessionId": 7, "reason": "error", "message": "a janela sumiu" })
        );

        let payload = ShareEndedPayload::new(7, EndReason::SourceClosed);
        assert_eq!(
            serde_json::to_value(&payload).unwrap(),
            serde_json::json!({ "sessionId": 7, "reason": "sourceClosed", "message": null })
        );
    }

    #[test]
    fn nomes_dos_eventos_seguem_o_contrato() {
        // O frontend escuta estes nomes (`PLAN.md`, 4.2). Mudar um lado sem o outro quebra em
        // silêncio: o evento sairia, e ninguém o ouviria.
        assert_eq!(SCREEN_SHARE_ENDED, "screen-share-ended");
        assert_eq!(SCREEN_SHARE_AUDIO_ENDED, "screen-share-audio-ended");
    }
}
