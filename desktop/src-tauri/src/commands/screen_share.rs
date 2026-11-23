//! Comandos da transmissão de tela (ADR 0017): a lista de fontes, começar, ajustar e parar; e os
//! eventos de fim e dos números a cada segundo.

use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tracing::{info, warn};

use crate::{
    error::AppError,
    media::{
        audio::AudioMode,
        focus,
        publisher::ShareTarget,
        quality::Quality,
        share::{ShareChange, ShareEvent, ShareManager, ShareRequest},
        sources::{self, CaptureSource, SourceRef},
        video::{StatsSnapshot, VideoConfig},
        EndReason,
    },
};

use super::run_blocking;
use crate::activity::Activity;

/// Nome do evento de fim da sessão (contrato com o frontend).
pub const SCREEN_SHARE_ENDED: &str = "screen-share-ended";
/// Nome do evento de fim só do áudio (contrato com o frontend).
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

/// Nome do evento de queda da conexão da transmissão: a captura segue, o frontend pede um token
/// novo e chama [`screen_share_reconnect`] (contrato com o frontend).
pub const SCREEN_SHARE_LINK_LOST: &str = "screen-share-link-lost";

/// Payload de `screen-share-link-lost`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkLostPayload {
    pub session_id: u64,
}

/// Traduz um evento do manager para o evento Tauri correspondente.
fn emit_share_event(app: &AppHandle, event: ShareEvent) {
    let (name, payload) = match event {
        ShareEvent::LinkLost { session_id } => {
            warn!(session_id, "a conexão da transmissão caiu");
            if let Err(error) = app.emit(SCREEN_SHARE_LINK_LOST, LinkLostPayload { session_id }) {
                warn!(event = SCREEN_SHARE_LINK_LOST, %error, "falha ao emitir evento para o frontend");
            }
            return;
        }
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

/// Nome do evento com os números da transmissão, a cada segundo.
pub const SCREEN_SHARE_STATS: &str = "screen-share-stats";
/// De quanto em quanto tempo os números vão para o frontend.
const STATS_EVERY: Duration = Duration::from_secs(1);
/// De quanto em quanto tempo um resumo vai para o arquivo de log.
const LOG_EVERY: Duration = Duration::from_secs(60);

/// O que o frontend escolheu no seletor, mais onde entrar (argumento de `screen_share_start`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShareOptions {
    pub source: SourceRef,
    pub quality: Quality,
    pub audio: AudioMode,
    pub cursor: bool,
    /// O nivelador do áudio (`media/leveler.rs`), ligado por padrão no app.
    pub leveler: bool,
    /// Codificar na placa de vídeo (v0.7). Desligado, o vídeo vai pelo plano B, na CPU, como sem
    /// encoder de hardware. Ausente (app antigo), ligado.
    #[serde(default = "encoder_default")]
    pub hardware_encoder: bool,
    pub target: ShareTarget,
}

fn encoder_default() -> bool {
    true
}

/// Um ajuste no meio (argumento de `screen_share_update`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ShareUpdate {
    Quality { quality: Quality },
    Source { source: SourceRef },
    Audio { audio: AudioMode },
    Cursor { enabled: bool },
    Paused { paused: bool },
    Leveler { enabled: bool },
}

impl ShareUpdate {
    fn into_change(self) -> ShareChange {
        match self {
            Self::Quality { quality } => ShareChange::Format(quality.format()),
            Self::Source { source } => ShareChange::Source(source),
            Self::Audio { audio } => ShareChange::Audio(audio),
            Self::Cursor { enabled } => ShareChange::Cursor(enabled),
            Self::Leveler { enabled } => ShareChange::Leveler(enabled),
            Self::Paused { paused } => ShareChange::Paused(paused),
        }
    }
}

/// Payload de `screen-share-stats`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsPayload {
    pub session_id: u64,
    #[serde(flatten)]
    pub stats: StatsSnapshot,
}

/// Cria o manager da transmissão nativa, ligado aos eventos do Tauri. Chamado uma vez, no `setup`.
pub fn create_manager(app: &AppHandle) -> Arc<ShareManager> {
    let app = app.clone();
    Arc::new(ShareManager::new(move |event| {
        emit_share_event(&app, event)
    }))
}

/// A janela escolhida vem para a frente (restaurada, se estava minimizada). O Ashtar não é
/// minimizado: fica onde está, atrás dela, e nunca aparece na captura (ADR 0019).
fn focus_source(source: SourceRef) {
    focus::bring_to_front(source);
}

/// Manda os números de `session_id` a cada segundo, e um resumo ao log a cada minuto, até a
/// transmissão acabar.
fn spawn_stats(app: AppHandle, manager: Arc<ShareManager>, session_id: u64) {
    tauri::async_runtime::spawn(async move {
        let mut last_log = Instant::now();
        loop {
            tokio::time::sleep(STATS_EVERY).await;
            let Some(stats) = manager.stats(session_id) else {
                return;
            };
            let snapshot = stats.snapshot(Instant::now());
            if last_log.elapsed() >= LOG_EVERY {
                last_log = Instant::now();
                info!(
                    target: "media",
                    session_id,
                    fps = snapshot.fps,
                    kbps = snapshot.bitrate_kbps,
                    alvo_kbps = snapshot.target_kbps,
                    ms = snapshot.latency_ms,
                    tamanho = %format!("{}x{}", snapshot.width, snapshot.height),
                    keyframes = snapshot.keyframes,
                    descartes = snapshot.dropped,
                    "resumo da transmissão"
                );
            }
            let payload = StatsPayload {
                session_id,
                stats: snapshot,
            };
            if let Err(error) = app.emit(SCREEN_SHARE_STATS, payload) {
                warn!(%error, "falha ao emitir os números da transmissão");
            }
        }
    });
}

/// Lista as janelas e telas que dá para compartilhar, inclusive as janelas minimizadas.
///
/// A enumeração e a extração de ícones bloqueiam, por isso rodam em [`run_blocking`].
#[tauri::command]
pub async fn list_capture_sources(
    activity: State<'_, Arc<Activity>>,
) -> Result<Vec<CaptureSource>, AppError> {
    let mut sources = run_blocking(sources::list_sources).await?;
    // A janela de um jogo aberto vai com o nome do jogo, não com o título que ele põe nela.
    activity.name_game_windows(&mut sources);
    Ok(sources)
}

/// Começa a transmissão: entra na sala como `:screen`, começa o vídeo e o áudio, traz a fonte para
/// a frente. Só responde depois que tudo começou (ou nada ficou rodando).
#[tauri::command]
pub async fn screen_share_start(
    app: AppHandle,
    manager: State<'_, Arc<ShareManager>>,
    options: ShareOptions,
) -> Result<u64, AppError> {
    // O navegador do WebView2 pode ter mudado desde a abertura: a captura da tela inteira exclui
    // o que está valendo agora.
    crate::webview_process::refresh(&app);
    let manager = Arc::clone(manager.inner());
    let request = ShareRequest {
        video: VideoConfig {
            source: options.source,
            format: options.quality.format(),
            cursor: options.cursor,
            software_encoder: !options.hardware_encoder,
        },
        audio: options.audio,
        leveler: options.leveler,
        target: options.target,
    };
    info!(
        target: "media",
        quality = ?options.quality,
        audio = ?options.audio,
        leveler = options.leveler,
        hardware_encoder = options.hardware_encoder,
        "começando a transmissão"
    );
    let starting = Arc::clone(&manager);
    let session_id = run_blocking(move || starting.start(request)).await?;
    focus_source(options.source);
    spawn_stats(app, manager, session_id);
    Ok(session_id)
}

/// Ajusta a transmissão no meio. Um id que já acabou é ignorado.
#[tauri::command]
pub async fn screen_share_update(
    app: AppHandle,
    manager: State<'_, Arc<ShareManager>>,
    session_id: u64,
    update: ShareUpdate,
) -> Result<(), AppError> {
    // O áudio novo da tela inteira exclui o navegador do WebView2 que está valendo agora.
    if let ShareUpdate::Audio { .. } = update {
        crate::webview_process::refresh(&app);
    }
    let manager = Arc::clone(manager.inner());
    run_blocking(move || manager.update(session_id, update.into_change())).await?;
    if let ShareUpdate::Source { source } = update {
        focus_source(source);
    }
    Ok(())
}

/// Encerra a transmissão. Idempotente: um id que já acabou não é erro.
#[tauri::command]
pub async fn screen_share_stop(
    manager: State<'_, Arc<ShareManager>>,
    session_id: u64,
) -> Result<(), AppError> {
    let manager = Arc::clone(manager.inner());
    run_blocking(move || manager.stop(session_id)).await
}

/// Volta a conexão de uma transmissão que caiu, com um token novo, sem parar a captura. Um id que
/// já acabou é ignorado.
#[tauri::command]
pub async fn screen_share_reconnect(
    manager: State<'_, Arc<ShareManager>>,
    session_id: u64,
    target: ShareTarget,
) -> Result<(), AppError> {
    let manager = Arc::clone(manager.inner());
    run_blocking(move || manager.reconnect(session_id, &target)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::video::EncoderKind;

    #[test]
    fn le_as_opcoes_enviadas_pelo_frontend() {
        let json = r#"{
            "source": { "kind": "window", "id": 123 },
            "quality": "1080p30",
            "audio": { "mode": "system" },
            "cursor": true,
            "leveler": true,
            "target": { "url": "wss://sala", "token": "abc", "trackName": "screen-share:{}" }
        }"#;
        let options: ShareOptions = serde_json::from_str(json).unwrap();
        assert_eq!(options.source, SourceRef::Window(123));
        assert_eq!(options.quality, Quality::Detail);
        assert!(options.leveler);
        // O app antigo não manda a escolha do encoder: fica a placa.
        assert!(options.hardware_encoder);
        assert_eq!(options.target.url, "wss://sala");

        let cpu = json.replace(
            r#""leveler": true,"#,
            r#""leveler": true, "hardwareEncoder": false,"#,
        );
        let options: ShareOptions = serde_json::from_str(&cpu).unwrap();
        assert!(!options.hardware_encoder);
    }

    #[test]
    fn le_cada_ajuste() {
        let cases = [
            (
                r#"{ "kind": "quality", "quality": "1080p60" }"#,
                ShareUpdate::Quality {
                    quality: Quality::Motion,
                },
            ),
            (
                r#"{ "kind": "source", "source": { "kind": "monitor", "id": 9 } }"#,
                ShareUpdate::Source {
                    source: SourceRef::Monitor(9),
                },
            ),
            (
                r#"{ "kind": "audio", "audio": { "mode": "off" } }"#,
                ShareUpdate::Audio {
                    audio: AudioMode::Off,
                },
            ),
            (
                r#"{ "kind": "cursor", "enabled": false }"#,
                ShareUpdate::Cursor { enabled: false },
            ),
            (
                r#"{ "kind": "paused", "paused": true }"#,
                ShareUpdate::Paused { paused: true },
            ),
            (
                r#"{ "kind": "leveler", "enabled": false }"#,
                ShareUpdate::Leveler { enabled: false },
            ),
        ];
        for (json, expected) in cases {
            assert_eq!(
                serde_json::from_str::<ShareUpdate>(json).unwrap(),
                expected,
                "{json}"
            );
        }
        assert!(serde_json::from_str::<ShareUpdate>(r#"{ "kind": "fps", "fps": 60 }"#).is_err());
    }

    #[test]
    fn numeros_no_formato_do_frontend() {
        let payload = StatsPayload {
            session_id: 3,
            stats: StatsSnapshot {
                encoder: EncoderKind::Hardware("AMDh264Encoder".into()),
                adapter: "AMD Radeon".into(),
                width: 1920,
                height: 1080,
                fps: 60,
                bitrate_kbps: 7_900,
                target_kbps: 8_000,
                latency_ms: 5.5,
                keyframes: 2,
                dropped: 0,
                paused: false,
            },
        };
        assert_eq!(
            serde_json::to_value(&payload).unwrap(),
            serde_json::json!({
                "sessionId": 3,
                "encoder": { "kind": "hardware", "name": "AMDh264Encoder" },
                "adapter": "AMD Radeon",
                "width": 1920,
                "height": 1080,
                "fps": 60,
                "bitrateKbps": 7900,
                "targetKbps": 8000,
                "latencyMs": 5.5,
                "keyframes": 2,
                "dropped": 0,
                "paused": false
            })
        );
        assert_eq!(SCREEN_SHARE_STATS, "screen-share-stats");
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
        // O frontend escuta estes nomes. Mudar um lado sem o outro quebra em silêncio: o evento
        // sairia, e ninguém o ouviria.
        assert_eq!(SCREEN_SHARE_ENDED, "screen-share-ended");
        assert_eq!(SCREEN_SHARE_AUDIO_ENDED, "screen-share-audio-ended");
        assert_eq!(SCREEN_SHARE_LINK_LOST, "screen-share-link-lost");
        assert_eq!(
            serde_json::to_value(LinkLostPayload { session_id: 3 }).unwrap(),
            serde_json::json!({ "sessionId": 3 })
        );
    }
}
