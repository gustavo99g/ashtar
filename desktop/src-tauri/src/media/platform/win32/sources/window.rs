//! Enriquece uma janela do DesktopCapturer com PID e icone.
//!
//! Usado por `media::sources::list_capture_sources`. As janelas em si (ids,
//! titulos) vem do DesktopCapturer — `EnumWindows` saiu do projeto (decisao
//! 2 do docs/plans/v0.1-reorganizacao.md). Os filtros de janela visivel/oculta/ferramenta tambem
//! saiam, porque o DesktopCapturer ja aplica filtros equivalentes na lista
//! dele; se aparecerem janelas que nao deveriam, esses filtros voltam aqui.

use windows_sys::Win32::{Foundation::HWND, UI::WindowsAndMessaging::GetWindowThreadProcessId};

use crate::media::{platform::sources::icon::icon_data_url, sources::WindowDetails};

/// Detalhes da janela, ou `None` se ela nao deve aparecer na lista (PID
/// invalido, ou janela do proprio app).
///
/// # Bloqueia
///
/// Chama `icon_data_url`, que pode esperar ate 50ms (veja `icon.rs`).
/// Chamar dentro de `spawn_blocking`.
pub fn window_details(id: u64) -> Option<WindowDetails> {
    let hwnd = id as usize as HWND;

    let process_id = window_process_id(hwnd)?;

    // Janelas do próprio app ficam fora: compartilhá-las com áudio
    // capturaria as vozes da chamada.
    if process_id == std::process::id() {
        return None;
    }

    Some(WindowDetails {
        process_id: Some(process_id),
        icon: icon_data_url(hwnd),
    })
}

fn window_process_id(hwnd: HWND) -> Option<u32> {
    let mut process_id: u32 = 0;
    // SAFETY: `hwnd` e um HWND recebido do DesktopCapturer (ou 0 nos
    // testes); `GetWindowThreadProcessId` aceita um HWND invalido e so
    // devolve 0 nesse caso, sem UB. `&mut process_id` e valido para escrita
    // de um u32.
    unsafe {
        GetWindowThreadProcessId(hwnd, &mut process_id);

        if process_id == 0 {
            None
        } else {
            Some(process_id)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    #[test]
    fn janela_invalida_nao_aparece() {
        assert!(window_details(0).is_none());
    }

    #[test]
    #[ignore = "precisa de uma área de trabalho real"]
    fn detalhes_da_janela_em_foco() {
        // SAFETY: `GetForegroundWindow` nao tem pre-condicoes; pode devolver
        // null (tratado como "sem janela em foco"), sem UB.
        let hwnd = unsafe { GetForegroundWindow() };
        let details =
            window_details(hwnd as usize as u64).expect("a janela em foco deveria aparecer");

        println!(
            "pid={:?} icone={}",
            details.process_id,
            details.icon.is_some()
        );
        assert!(details.process_id.is_some());
    }
}
