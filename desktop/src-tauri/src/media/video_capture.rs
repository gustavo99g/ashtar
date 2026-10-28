//! Captura de vídeo de uma janela ou tela com o `DesktopCapturer` do libwebrtc.
//!
//! Código comum, com duas ajudas da plataforma (`platform::`) para janelas:
//! - `prepare_window_capture_thread`: com COM na thread, o libwebrtc captura janelas pelo WGC em
//!   vez do GDI, ~3× mais rápido numa janela 4K (ADR 0008). As telas não precisam de COM.
//! - `window_state`: o WGC não avisa quando a janela fecha, então o laço confere a cada volta.
//!
//! - Taxa controlada por deadline: um frame por intervalo, sem acumular atraso.
//! - Com o `FrameGate` do sink fechado, não captura (nada de trabalho jogado fora).
//! - Conversão para I420 respeitando o stride do frame; redução para caber na
//!   caixa do preset, sem nunca ampliar, sempre com dimensões pares.
//! - Fonte fechada encerra com `SourceClosed`. Janela minimizada não é capturada:
//!   a captura continua, reenviando o último frame.

use livekit::webrtc::native::yuv_helper::argb_to_i420;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use tracing::{info, warn};

use super::platform;
use super::sources::SourceRef;
use crate::error::AppError;
use crate::media::{
    spawn_capture, CaptureHandle, CapturedFrame, EndReason, OnEnd, SinkStatus, VideoSink,
};
use livekit::webrtc::desktop_capturer::{self as dc, DesktopFrame};
use livekit::webrtc::video_frame::I420Buffer;

/// Menor lado aceito, tanto de um frame capturado quanto da caixa máxima.
const MIN_SIDE: u32 = 16;
/// Maior fps aceito na configuração (o preset mais rápido é 60).
const MAX_FPS: u32 = 60;
/// Espera entre checagens enquanto o `FrameGate` está fechado.
const GATE_POLL: Duration = Duration::from_millis(1);
/// De quanto em quanto tempo, durante uma sequência de falhas, conferimos se a fonte ainda existe.
const CHECK_SOURCE_AFTER: Duration = Duration::from_secs(1);
/// Quanto tempo sem frame novo até reenviar o último.
const RESEND_AFTER: Duration = Duration::from_millis(500);

/// Configuração de uma captura de vídeo (preenchida a partir do preset de qualidade).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VideoCaptureConfig {
    /// Janela ou tela a capturar.
    pub source: SourceRef,
    /// Caixa máxima: a imagem é reduzida para caber nela, mantendo a proporção.
    pub max_width: u32,
    pub max_height: u32,
    /// Quadros por segundo desejados, de 1 a [`MAX_FPS`].
    pub fps: u32,
}

impl VideoCaptureConfig {
    fn validate(&self) -> Result<(), AppError> {
        if !(1..=MAX_FPS).contains(&self.fps) {
            return Err(AppError::VideoCapture(format!(
                "fps inválido: {}",
                self.fps
            )));
        }
        if self.max_width < MIN_SIDE || self.max_height < MIN_SIDE {
            return Err(AppError::VideoCapture(format!(
                "caixa inválida: {}x{}",
                self.max_width, self.max_height
            )));
        }
        Ok(())
    }

    /// Tempo entre um frame e o próximo.
    fn frame_interval(&self) -> Duration {
        Duration::from_secs(1) / self.fps
    }
}

/// Estado de uma janela sendo capturada, conferido a cada volta do laço.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowState {
    /// Existe e não está minimizada.
    Visible,
    /// Existe, mas está minimizada: não há o que capturar.
    Minimized,
    /// Não existe mais (fechou).
    Gone,
}

/// Tamanho final de um frame `width` × `height` para caber na caixa, mantendo a proporção.
///
/// Nunca amplia, e devolve sempre dimensões pares: no I420 cada amostra de cor
/// cobre um bloco de 2×2 pixels, e os encoders exigem lados pares.
fn fit_in_box(width: u32, height: u32, max_width: u32, max_height: u32) -> (u32, u32) {
    // Em u64, as multiplicações abaixo não têm como estourar.
    let (w, h) = (u64::from(width), u64::from(height));
    let (mw, mh) = (u64::from(max_width), u64::from(max_height));

    let (w, h) = if w <= mw && h <= mh {
        (w, h) // já cabe: fica como está
    } else if w * mh > h * mw {
        (mw, h * mw / w) // proporcionalmente mais larga que a caixa: a largura
    } else {
        (w * mh / h, mh) // mais alta que a caixa: a altura limita
    };
    (even(w), even(h))
}

/// Arredonda para baixo até um número par, com mínimo de 2.
fn even(side: u64) -> u32 {
    (side as u32 & !1).max(2)
}

/// O que o callback do `DesktopCapturer` entregou numa chamada de `capture_frame`.
enum Grab {
    /// Frame convertido e já no tamanho final.
    Frame(I420Buffer),
    /// Frame pequeno demais para ter conteúdo (ex.: o 1×1 de uma janela minimizada).
    Tiny,
    /// A captura falhou nesta chamada.
    Failed(dc::CaptureError),
}

/// Inicia a captura de vídeo da fonte escolhida, entregando os frames ao `sink`.
///
/// Uma fonte que não existe (ou uma janela do próprio app) falha com `SourceNotFound`.
///
/// # Bloqueia
///
/// Espera a captura inicializar. Só chamar dentro de `spawn_blocking`.
pub fn spawn_video_capture(
    config: VideoCaptureConfig,
    mut sink: impl VideoSink,
    on_end: OnEnd,
) -> Result<CaptureHandle, AppError> {
    config.validate()?;

    spawn_capture("video-capture", on_end, move |mut ctx| {
        let (mut captures, grabs) = match open_capturer(config) {
            Ok(opened) => opened,
            Err(e) => {
                let message = e.to_string();
                ctx.ready.fail(e);
                return EndReason::Error(message);
            }
        };

        ctx.ready.ok();
        info!(?config, "captura de vídeo iniciada");

        let reason = run(&mut captures, &grabs, config, &mut sink, &ctx.stop);
        info!(?reason, "captura de vídeo encerrada");
        reason
    })
}

/// Cria o capturer, confere que a fonte existe e liga o callback de conversão.
///
/// Só pode ser chamada na thread de captura: o capturer vive e morre nela.
fn open_capturer(
    config: VideoCaptureConfig,
) -> Result<(dc::DesktopCapturer, mpsc::Receiver<Grab>), AppError> {
    let (kind, id) = match config.source {
        SourceRef::Window(id) => {
            // Com COM, o libwebrtc captura a janela pelo WGC; sem, cai no GDI (ADR 0008).
            platform::prepare_window_capture_thread();
            (dc::DesktopCaptureSourceType::Window, id)
        }
        // Telas não precisam de COM: com e sem COM, a tela 4K deu o mesmo fps e carregou as mesmas
        // DLLs (ADR 0008). Por isso só as janelas ganham a preparação acima.
        SourceRef::Monitor(id) => (dc::DesktopCaptureSourceType::Screen, id),
    };

    let mut options = dc::DesktopCapturerOptions::new(kind);
    options.set_include_cursor(true);

    let mut capturer = dc::DesktopCapturer::new(options)
        .ok_or_else(|| AppError::VideoCapture("Não foi possível criar o DesktopCapturer".into()))?;

    // O capturer não lista as janelas do próprio app, então pedir uma delas também cai aqui.
    let source = capturer
        .get_source_list()
        .into_iter()
        .find(|s| s.id() == id)
        .ok_or(AppError::SourceNotFound(id))?;

    // O callback roda dentro do `capture_frame`, mas a assinatura exige `Send + 'static`,
    // então ele não pode pegar emprestado nada do laço. Ele converte o frame (que só
    // existe durante o callback) e manda o resultado pelo canal.
    let (tx, rx) = mpsc::channel();
    capturer.start_capture(Some(source), move |result| {
        let grab = match result {
            Ok(frame) => match to_i420(&frame, config.max_width, config.max_height) {
                Some(buffer) => Grab::Frame(buffer),
                None => Grab::Tiny,
            },
            Err(e) => Grab::Failed(e),
        };
        let _ = tx.send(grab);
    });
    Ok((capturer, rx))
}

/// Converte o frame do capturer para I420 e reduz para caber na caixa.
///
/// O `DesktopFrame` guarda os pixels como B, G, R, A na memória. No libyuv esse
/// formato se chama "ARGB", porque o nome descreve um inteiro de 32 bits lido em
/// little-endian, e não a ordem dos bytes. Por isso `argb_to_i420` é a conversão certa.
fn to_i420(frame: &DesktopFrame, max_width: u32, max_height: u32) -> Option<I420Buffer> {
    let (width, height) = (frame.width(), frame.height());
    if width < MIN_SIDE as i32 || height < MIN_SIDE as i32 {
        return None;
    }
    let (width, height) = (width as u32, height as u32);
    let mut full = I420Buffer::new(width, height);
    let (stride_y, stride_u, stride_v) = full.strides();
    let (y, u, v) = full.data_mut();

    // `frame.stride()` é o tamanho real de cada linha em bytes, que pode ser maior
    // que `width * 4` quando a textura tem sobra no fim das linhas.
    argb_to_i420(
        frame.data(),
        frame.stride(),
        y,
        stride_y,
        u,
        stride_u,
        v,
        stride_v,
        width as i32,
        height as i32,
    );

    let (target_width, target_height) = fit_in_box(width, height, max_width, max_height);
    if (target_width, target_height) == (width, height) {
        Some(full)
    } else {
        Some(full.scale(target_width as i32, target_height as i32))
    }
}

/// Confere se a fonte ainda aparece na lista do capturer. Uma janela fechada
/// (ou uma tela desconectada) some da lista; uma janela minimizada continua nela.
fn source_listed(capturer: &dc::DesktopCapturer, id: u64) -> bool {
    capturer.get_source_list().iter().any(|s| s.id() == id)
}

/// Laço de captura: roda até o `stop` ou até o sink pedir para parar.
fn run(
    capturer: &mut dc::DesktopCapturer,
    grabs: &mpsc::Receiver<Grab>,
    config: VideoCaptureConfig,
    sink: &mut impl VideoSink,
    stop: &AtomicBool,
) -> EndReason {
    let (SourceRef::Window(id) | SourceRef::Monitor(id)) = config.source;

    // `Some(id)` só para janelas: telas não têm estado a conferir.
    let window = match config.source {
        SourceRef::Window(id) => Some(id),
        SourceRef::Monitor(_) => None,
    };

    let gate = sink.gate();
    let interval = config.frame_interval();
    let started = Instant::now();
    let mut next = started;

    let mut last: Option<CapturedFrame> = None;
    let mut last_push = started;
    // Início da sequência atual de falhas, e quando a fonte foi conferida pela última vez.
    let mut failing_since: Option<Instant> = None;
    let mut last_source_check = started;

    while !stop.load(Ordering::Acquire) {
        let now = Instant::now();
        if now < next {
            thread::sleep(next - now);
            continue;
        }

        if gate.as_ref().is_some_and(|g| !g.is_open()) {
            thread::sleep(GATE_POLL);
            continue;
        }
        // O próximo deadline conta a partir do anterior, não de agora: assim o ritmo
        // não escorrega. Se atrasou mais de um intervalo inteiro, recomeça a partir de
        // agora, em vez de tentar compensar com uma rajada de frames.
        next += interval;
        if next <= now {
            next = now + interval;
        }
        let timestamp_us = started.elapsed().as_micros() as i64;

        // O WGC não avisa quando a janela fecha (provavelmente porque a thread não tem laço de
        // mensagens) e, com ela minimizada, só repetiria o último frame. Então conferimos nós
        // mesmos, a cada volta.
        let state = window.map_or(WindowState::Visible, platform::window_state);

        match state {
            WindowState::Gone => return EndReason::SourceClosed,
            WindowState::Minimized => {}
            WindowState::Visible => capturer.capture_frame(),
        }

        match grabs.try_recv() {
            Ok(Grab::Frame(buffer)) => {
                if let Some(since) = failing_since.take() {
                    info!(
                        after_ms = since.elapsed().as_millis() as u64,
                        "a captura de vídeo voltou a entregar frames"
                    );
                }
                let frame = CapturedFrame {
                    buffer,
                    timestamp_us,
                };
                if let SinkStatus::Stop = sink.push(&frame) {
                    return EndReason::Stopped;
                }
                last = Some(frame);
                last_push = Instant::now();
                continue;
            }
            Ok(Grab::Failed(error)) => {
                // Registra só o começo da sequência de falhas, e não cada frame.
                if failing_since.is_none() {
                    warn!(?error, "a captura de vídeo começou a falhar");
                    failing_since = Some(Instant::now());
                    last_source_check = Instant::now();
                }

                if last_source_check.elapsed() >= CHECK_SOURCE_AFTER {
                    if !source_listed(capturer, id) {
                        return EndReason::SourceClosed;
                    }
                    // Ainda existe (minimizada, por exemplo): confere de novo daqui a pouco.
                    last_source_check = Instant::now();
                }
            }
            Ok(Grab::Tiny) | Err(_) => {}
        }

        // Sem frame novo: reenvia o último de tempos em tempos, para quem assiste
        // (e quem entrar agora) continuar vendo a imagem.
        if let Some(frame) = last.as_mut() {
            if last_push.elapsed() >= RESEND_AFTER {
                frame.timestamp_us = timestamp_us;
                if let SinkStatus::Stop = sink.push(frame) {
                    return EndReason::Stopped;
                }
                last_push = Instant::now();
            }
        }
    }

    EndReason::Stopped
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::diagnostics::LogVideoSink;
    use crate::media::sources::list_capture_sources;

    fn config(fps: u32, max_width: u32, max_height: u32) -> VideoCaptureConfig {
        VideoCaptureConfig {
            source: SourceRef::Monitor(0),
            max_width,
            max_height,
            fps,
        }
    }

    #[test]
    fn reduz_para_caber_na_caixa() {
        assert_eq!(fit_in_box(1920, 1080, 1280, 720), (1280, 720));
        assert_eq!(fit_in_box(2560, 1440, 1600, 900), (1600, 900));
        // Ultrawide: a largura limita. 1440 × 1280 / 3440 = 535,8 → 535 → par: 534.
        assert_eq!(fit_in_box(3440, 1440, 1280, 720), (1280, 534));
        // Janela alta e estreita: a altura limita.
        assert_eq!(fit_in_box(500, 2000, 1280, 720), (180, 720));
    }

    #[test]
    fn nunca_amplia() {
        assert_eq!(fit_in_box(1280, 720, 1920, 1080), (1280, 720));
        assert_eq!(fit_in_box(800, 600, 1280, 720), (800, 600));
    }

    #[test]
    fn dimensoes_sempre_pares_e_nunca_zero() {
        assert_eq!(fit_in_box(1001, 601, 1280, 720), (1000, 600));
        // Tão estreita que a largura reduzida daria 1: o mínimo é 2.
        assert_eq!(fit_in_box(16, 10_000, 1280, 720), (2, 720));
    }

    #[test]
    fn recusa_configuracao_invalida() {
        assert!(config(60, 1280, 720).validate().is_ok());
        assert!(matches!(
            config(0, 1280, 720).validate(),
            Err(AppError::VideoCapture(_))
        ));
        assert!(matches!(
            config(61, 1280, 720).validate(),
            Err(AppError::VideoCapture(_))
        ));
        assert!(matches!(
            config(30, 0, 720).validate(),
            Err(AppError::VideoCapture(_))
        ));
    }

    #[test]
    fn intervalo_entre_frames() {
        assert_eq!(
            config(30, 1920, 1080).frame_interval(),
            Duration::from_nanos(33_333_333)
        );
        assert_eq!(
            config(60, 1280, 720).frame_interval(),
            Duration::from_nanos(16_666_666)
        );
    }

    // ------------------------------------------------------------------------
    // Testes com captura de verdade (rodar com `-- --ignored --nocapture`)
    // ------------------------------------------------------------------------

    /// Liga os logs dentro dos testes. Sem isso, os relatórios do sink não aparecem.
    fn init_test_logs() {
        let _ = tracing_subscriber::fmt()
            .with_env_filter(tracing_subscriber::EnvFilter::new("info,perf=debug"))
            .with_test_writer()
            .try_init();
    }

    /// fps pedido pela variável CAPTURE_FPS, ou 60 se ela não existir.
    fn fps_from_env() -> u32 {
        std::env::var("CAPTURE_FPS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(60)
    }

    /// Captura por `seconds` segundos, ou até a captura acabar sozinha, e devolve o motivo do fim.
    fn capture_for(source: SourceRef, seconds: u64) -> EndReason {
        init_test_logs();

        let (tx, rx) = mpsc::channel();
        let config = VideoCaptureConfig {
            source,
            max_width: 1280,
            max_height: 720,
            fps: fps_from_env(),
        };
        let handle = spawn_video_capture(
            config,
            LogVideoSink::new(),
            Box::new(move |reason| {
                let _ = tx.send(reason);
            }),
        )
        .expect("a captura deveria iniciar");

        // Se a captura acabar sozinha (janela fechada, por exemplo), o on_end chega antes do tempo.
        let early = rx.recv_timeout(Duration::from_secs(seconds)).ok();
        handle.stop_and_join();

        early.unwrap_or_else(|| {
            rx.recv_timeout(Duration::from_secs(1))
                .expect("o on_end deveria ter sido chamado")
        })
    }

    fn primary_monitor() -> SourceRef {
        list_capture_sources()
            .expect("a listagem falhou")
            .into_iter()
            .find(|s| s.monitor.as_ref().is_some_and(|m| m.is_primary))
            .expect("nenhuma tela principal encontrada")
            .source
    }

    #[test]
    #[ignore = "precisa de uma área de trabalho real"]
    fn fonte_inexistente_falha_na_inicializacao() {
        let config = VideoCaptureConfig {
            source: SourceRef::Window(0),
            ..config(30, 1280, 720)
        };
        let result = spawn_video_capture(config, LogVideoSink::new(), Box::new(|_| {}));
        assert!(matches!(result, Err(AppError::SourceNotFound(0))));
    }

    #[test]
    #[ignore = "precisa de uma área de trabalho real"]
    fn captura_a_tela_principal() {
        let reason = capture_for(primary_monitor(), 10);
        assert!(
            matches!(reason, EndReason::Stopped),
            "motivo inesperado: {reason:?}"
        );
    }

    #[test]
    #[ignore = "precisa de CAPTURE_MONITOR com o id de uma tela"]
    fn captura_uma_tela() {
        let id: u64 = std::env::var("CAPTURE_MONITOR")
            .expect("defina a variável CAPTURE_MONITOR")
            .parse()
            .expect("CAPTURE_MONITOR deve ser um número");

        let reason = capture_for(SourceRef::Monitor(id), 10);
        println!("motivo do fim: {reason:?}");
    }

    #[test]
    #[ignore = "precisa de CAPTURE_WINDOW com o id de uma janela"]
    fn captura_uma_janela() {
        let id: u64 = std::env::var("CAPTURE_WINDOW")
            .expect("defina a variável CAPTURE_WINDOW")
            .parse()
            .expect("CAPTURE_WINDOW deve ser um número");

        let reason = capture_for(SourceRef::Window(id), 30);
        println!("motivo do fim: {reason:?}");
    }
}
