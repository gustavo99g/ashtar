//! Quanto tempo faz que ninguém mexe no computador, para o Ausente automático (ADR 0027).
//!
//! Conta o teclado e o mouse de qualquer janela do Windows, não só do Ashtar: quem está jogando com
//! o Ashtar no fundo não fica ausente. O controle de videogame não conta, e por isso o app não
//! manda o Ausente estando numa sala de voz.

use crate::error::AppError;

/// Os segundos desde o último toque no teclado ou no mouse, em todo o Windows.
#[tauri::command]
pub async fn idle_seconds() -> Result<u64, AppError> {
    Ok(platform_idle_seconds())
}

#[cfg(windows)]
fn platform_idle_seconds() -> u64 {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    let mut info = LASTINPUTINFO {
        cbSize: size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    // SAFETY: `info` é uma LASTINPUTINFO válida, com o `cbSize` certo, e vive durante a chamada.
    if unsafe { GetLastInputInfo(&mut info) } == 0 {
        return 0;
    }
    // SAFETY: sem argumentos nem estado; só lê o relógio do sistema.
    let now = unsafe { GetTickCount() };
    // Os dois são milissegundos desde o boot em 32 bits: o `wrapping_sub` atravessa a volta dos
    // 49 dias.
    u64::from(now.wrapping_sub(info.dwTime)) / 1000
}

/// Fora do Windows (os testes), ninguém fica ocioso.
#[cfg(not(windows))]
fn platform_idle_seconds() -> u64 {
    0
}
