//! Implementação usada em qualquer sistema sem suporte de plataforma.
//!
//! window_details devolve valores vazios (a janela ainda aparece na
//! lista, so sem PID/icone); monitor_details devolve None (nenhum dado
//! extra sobre o monitor). audio_capture.rs ganha o equivalente
//! (retornando AppError::Unsupported) quando a captura de audio entrar
//! aqui (passo 5).

use crate::media::sources::{MonitorInfo, WindowDetails};

use crate::error::AppError;
use crate::media::{audio::AudioTarget, AudioSink, CaptureHandle, OnEnd};

/// Sempre `Some`, com os campos vazios: sem implementacao de plataforma,
/// ainda mostramos a janela na lista, so sem PID/icone.
pub fn window_details(_id: u64) -> Option<WindowDetails> {
    Some(WindowDetails {
        process_id: None,
        icon: None,
    })
}

/// Sempre `None`: sem implementacao de plataforma, nao sabemos nada sobre
/// o monitor alem do que o DesktopCapturer ja devolve.
pub fn monitor_details(_id: u64) -> Option<MonitorInfo> {
    None
}

pub fn spawn_audio_capture(
    _target: AudioTarget,
    _sink: impl AudioSink,
    _on_end: OnEnd,
) -> Result<CaptureHandle, AppError> {
    Err(AppError::Unsupported("captura de áudio"))
}
