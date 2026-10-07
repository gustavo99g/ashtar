//! Implementacao real, no Windows, dos pontos de entrada de media::sources.
//!
//! window.rs e monitor.rs reexportam window_details/monitor_details (o
//! contrato que platform::mod.rs espera); icon.rs e gdi.rs sao detalhe de
//! implementacao, privados a este modulo.

pub mod monitor;
pub mod thumbnail;
pub mod window;

mod gdi;
mod icon;

pub use monitor::monitor_details;
pub use window::window_details;

#[cfg(test)]
mod window_tests {
    use crate::media::platform::sources::icon::icon_data_url;

    use super::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    #[test]
    #[ignore = "precisa de uma área de trabalho real"]
    fn icone_da_janela_em_foco() {
        // SAFETY: GetForegroundWindow nao tem pre-condicoes; pode devolver
        // null (o icon_data_url so devolveria None nesse caso).
        let hwnd = unsafe { GetForegroundWindow() };
        let url = icon_data_url(hwnd).expect("a janela em foco deveria ter ícone");
        assert!(url.starts_with("data:image/png;base64,"));
        println!("{url}");
    }
}

#[cfg(test)]
mod monitor_tests {
    use crate::media::platform::sources::monitor::until_nul;

    use super::*;

    #[test]
    fn corta_no_primeiro_zero() {
        assert_eq!(until_nul(&[65, 66, 0, 67]), vec![65, 66]);
        assert_eq!(until_nul(&[65, 66]), vec![65, 66]);
    }

    #[test]
    #[ignore = "precisa de uma área de trabalho real"]
    fn mapeia_telas_do_capturer() {
        use livekit::webrtc::desktop_capturer::{
            DesktopCaptureSourceType, DesktopCapturer, DesktopCapturerOptions,
        };

        let capturer = DesktopCapturer::new(DesktopCapturerOptions::new(
            DesktopCaptureSourceType::Screen,
        ))
        .expect("não foi possível criar o DesktopCapturer");

        for source in capturer.get_source_list() {
            let details = monitor_details(source.id());
            println!(
                "id={} titulo={:?} -> {:?}",
                source.id(),
                source.title(),
                details
            );
            assert!(
                details.is_some(),
                "a tela {} não teve correspondência",
                source.id()
            );
        }
    }
}
