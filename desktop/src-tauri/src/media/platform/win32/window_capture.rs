//! O que a captura de vídeo de janelas precisa da plataforma.
//!
//! A captura em si é do `DesktopCapturer` do libwebrtc. Para janelas ele usa o Windows Graphics
//! Capture (WGC), mas só se a thread tiver COM inicializado; sem COM, cai no GDI, ~3× mais lento
//! numa janela 4K (ADR 0008). E como a thread de captura provavelmente não tem laço de mensagens, o aviso de
//! janela fechada do WGC nunca chega: a existência da janela é conferida aqui.

use tracing::warn;
use windows_sys::Win32::{
    Foundation::HWND,
    UI::WindowsAndMessaging::{IsIconic, IsWindow},
};

use crate::media::video_capture::WindowState;

/// Prepara a thread atual para capturar uma janela: inicializa o COM (MTA).
///
/// Chamar na thread de captura, antes de criar o `DesktopCapturer`. Só para janelas: telas
/// ficam sem COM porque não precisam: testado com a tela 4K, o fps e as DLLs carregadas são os mesmos
/// com e sem COM (ADR 0008).
pub fn prepare_window_capture_thread() {
    let result = wasapi::initialize_mta();
    if result.is_err() {
        warn!(
            ?result,
            "COM não inicializou: a janela pode ser capturada por GDI, mais lento"
        );
    }
}

/// Diz se a janela ainda existe e se está minimizada.
pub fn window_state(id: u64) -> WindowState {
    let hwnd = id as usize as HWND;
    // SAFETY: `IsWindow` e `IsIconic` aceitam qualquer valor de HWND, inclusive inválido ou de
    // uma janela que já fechou, e só devolvem 0 nesses casos, sem UB.
    unsafe {
        if IsWindow(hwnd) == 0 {
            return WindowState::Gone;
        }
        if IsIconic(hwnd) != 0 {
            return WindowState::Minimized;
        }
    }
    WindowState::Visible
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    #[test]
    fn janela_invalida_nao_existe() {
        assert_eq!(window_state(0), WindowState::Gone);
    }

    #[test]
    #[ignore = "precisa de uma área de trabalho real"]
    fn janela_em_foco_esta_visivel() {
        // SAFETY: `GetForegroundWindow` não tem pré-condições; pode devolver null, sem UB.
        let hwnd = unsafe { GetForegroundWindow() };
        assert_eq!(window_state(hwnd as usize as u64), WindowState::Visible);
    }
}
