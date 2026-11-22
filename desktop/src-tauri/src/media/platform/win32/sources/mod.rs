//! A lista de telas e janelas no Windows (`list.rs`), com os ícones (`icon.rs` e `gdi.rs`, detalhe
//! de implementação).

pub mod list;

mod gdi;
mod icon;

pub use icon::exe_icon_png;

#[cfg(test)]
mod window_tests {
    use crate::media::platform::sources::icon::icon_data_url;
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
