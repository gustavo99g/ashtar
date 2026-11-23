//! A janela escolhida para a frente e o Ashtar fora das capturas: ponto de entrada comum
//! (ADR 0019). A implementação mora em `platform/`.

use super::platform;
use super::sources::SourceRef;

/// Traz a fonte escolhida para a frente (uma janela minimizada é restaurada). Para uma tela, não
/// há o que trazer. Devolve se o Windows deu o foco à janela.
pub fn bring_to_front(source: SourceRef) -> bool {
    match source {
        SourceRef::Window(id) => platform::bring_to_front(id),
        SourceRef::Monitor(_) => false,
    }
}

/// Tira uma janela do app de toda captura de tela, inclusive a da própria transmissão (quem
/// assiste uma tela inteira vê o que está atrás do Ashtar), ou a devolve (`excluded` falso).
pub fn exclude_from_capture(window: &tauri::WebviewWindow, excluded: bool) {
    #[cfg(windows)]
    match window.hwnd() {
        Ok(hwnd) => platform::exclude_from_capture(hwnd.0 as usize, excluded),
        Err(error) => tracing::warn!(%error, "sem o HWND da janela"),
    }
    #[cfg(not(windows))]
    let _ = (window, excluded);
}
