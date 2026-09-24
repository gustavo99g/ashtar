//! Implementação real da listagem/captura de fontes no Windows.

use crate::media::sources::{MonitorInfo, WindowDetails};

pub mod monitors;
pub mod thumbnail;
pub mod windows;

mod gdi;
mod icon;

pub fn window_details(_id: u64) -> Option<WindowDetails> {
    Some(WindowDetails {
        process_id: None,
        icon: None,
    })
}

pub fn monitor_details(_id: u64) -> Option<MonitorInfo> {
    None
}

#[cfg(test)]
mod tests {
    use crate::media::platform::sources::icon::icon_data_url;

    use super::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    #[test]
    #[ignore = "precisa de uma área de trabalho real"]
    fn icone_da_janela_em_foco() {
        let hwnd = unsafe { GetForegroundWindow() };
        let url = icon_data_url(hwnd).expect("a janela em foco deveria ter ícone");
        assert!(url.starts_with("data:image/png;base64,"));
        println!("{url}");
    }
}
