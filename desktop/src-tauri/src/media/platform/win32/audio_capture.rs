//! Implementação real da captura de áudio no Windows (WASAPI).
//!
//! Vazio por enquanto — entra no passo 3/5.

use crate::error::AppError;
use crate::media::{audio::AudioTarget, AudioSink, CaptureHandle, OnEnd};

pub fn spawn_audio_capture(
    _target: AudioTarget,
    _sink: impl AudioSink,
    _on_end: OnEnd,
) -> Result<CaptureHandle, AppError> {
    Err(AppError::Unsupported("captura de áudio"))
}
