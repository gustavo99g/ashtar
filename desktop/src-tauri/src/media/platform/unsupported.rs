//! Implementação usada em qualquer sistema sem suporte de plataforma: as listas vêm vazias e as
//! capturas falham com `AppError::Unsupported`.

use std::sync::mpsc::Receiver;

use crate::error::AppError;
use crate::media::encoded::PacketSink;
use crate::media::sources::{MonitorEntry, SourceRef, WindowEntry};
use crate::media::thumbnails::OnThumbnail;
use crate::media::video::{VideoConfig, VideoControl, VideoStats};
use crate::media::{audio::AudioTarget, AudioSink, CaptureHandle, OnEnd};

/// Sempre `Err(Unsupported)`: sem implementacao de plataforma nao ha como
/// capturar audio. Nao cria thread nem chama o `on_end`.
///
/// # Bloqueia
///
/// Aqui falha na hora, mas a assinatura e a mesma da versao real, que espera
/// a captura inicializar: chamar so dentro de `spawn_blocking`.
pub fn spawn_audio_capture(
    _target: AudioTarget,
    _sink: impl AudioSink,
    _on_end: OnEnd,
) -> Result<CaptureHandle, AppError> {
    Err(AppError::Unsupported("captura de áudio"))
}

/// Sem implementação de plataforma, não há placa para dizer.
pub fn gpu_name() -> Option<String> {
    None
}

/// Sempre vazia: sem implementação de plataforma, não há janelas para listar.
pub fn list_windows() -> Vec<WindowEntry> {
    Vec::new()
}

/// Sempre vazia: sem implementação de plataforma, não há telas para listar.
pub fn list_monitors() -> Vec<MonitorEntry> {
    Vec::new()
}

/// Não faz nada: sem implementação de plataforma, não há janela para trazer.
pub fn bring_to_front(_id: u64) -> bool {
    false
}

/// Não faz nada: sem implementação de plataforma, não há captura de que sair.
pub fn exclude_from_capture(_hwnd: usize) {}

/// Sempre `Err(Unsupported)`: sem implementação de plataforma, não há captura de vídeo.
pub fn spawn_video(
    _config: VideoConfig,
    _force_software: bool,
    _sink: impl PacketSink,
    _on_end: OnEnd,
) -> Result<(CaptureHandle, VideoControl, VideoStats), AppError> {
    Err(AppError::Unsupported("captura de vídeo"))
}

/// Sempre `Err(Unsupported)`: sem implementação de plataforma, não há miniaturas.
pub fn spawn_thumbnails(
    _sources: Vec<SourceRef>,
    _updates: Receiver<Vec<SourceRef>>,
    _on_thumbnail: OnThumbnail,
) -> Result<CaptureHandle, AppError> {
    Err(AppError::Unsupported("miniaturas"))
}

pub fn exe_icon_png(_path: &str, _size: u32) -> Option<Vec<u8>> {
    None
}

pub fn capture_still(_source: SourceRef) -> Result<(Vec<u8>, u32, u32), AppError> {
    Err(AppError::Unsupported("print"))
}

pub fn copy_image(_owner: usize, _dib: &[u8], _png: &[u8]) -> Result<(), AppError> {
    Err(AppError::Unsupported("área de transferência"))
}
