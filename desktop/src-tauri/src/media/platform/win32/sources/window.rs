//! Enumeração de janelas (`EnumWindows`).
//!
//! Vazio por enquanto — entra no passo 3/5.

use windows_sys::Win32::{Foundation::HWND, UI::WindowsAndMessaging::GetWindowThreadProcessId};

use crate::media::{platform::sources::icon::icon_data_url, sources::WindowDetails};

/// Detalhes da janela, ou `None` se ela não deve aparecer na lista.
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
