//! Implementação usada em qualquer sistema sem suporte de plataforma.
//!
//! window_details devolve valores vazios (a janela ainda aparece na
//! lista, so sem PID/icone); monitor_details devolve None (nenhum dado
//! extra sobre o monitor); spawn_audio_capture devolve
//! AppError::Unsupported, ja que nao ha captura de audio sem plataforma.

use crate::error::AppError;
use crate::media::sources::{MonitorEntry, MonitorInfo, WindowDetails, WindowEntry};

use crate::media::video_capture::WindowState;
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

/// Não faz nada: sem implementação de plataforma, não há o que preparar.
pub fn prepare_window_capture_thread() {}

/// Sempre `Visible`: sem implementação de plataforma, não sabemos. Uma janela fechada ainda
/// encerra a captura pelo caminho de falhas do `DesktopCapturer`.
pub fn window_state(_id: u64) -> WindowState {
    WindowState::Visible
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
