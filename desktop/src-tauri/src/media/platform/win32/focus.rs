//! A janela escolhida vem para a frente, e o Ashtar fica fora de qualquer captura (ADR 0019).

use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    IsIconic, IsWindow, SetForegroundWindow, SetWindowDisplayAffinity, ShowWindow, SW_RESTORE,
    WDA_EXCLUDEFROMCAPTURE,
};

/// Restaura a janela `id` (se estiver minimizada) e a traz para a frente, com o foco.
///
/// O Windows só deixa um app trocar o foco quando ele mesmo está em primeiro plano. No clique de
/// "Transmitir" o Ashtar está; por isso a troca acontece no início da transmissão. Devolve se o Windows aceitou dar o foco (restaurar funciona mesmo sem ele).
pub fn bring_to_front(id: u64) -> bool {
    let hwnd = HWND(id as usize as *mut _);
    // SAFETY: as três chamadas aceitam qualquer `HWND`, inclusive o de uma janela que fechou no
    // meio; nesse caso só devolvem falso.
    unsafe {
        if !IsWindow(Some(hwnd)).as_bool() {
            return false;
        }
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        SetForegroundWindow(hwnd).as_bool()
    }
}

/// Tira a janela `hwnd` (o valor do `HWND`) de toda captura de tela: a do Ashtar, a do print do Windows
/// (Win + Shift + S), a do OBS. Quem assiste vê o que está atrás dela.
///
/// Precisa do Windows 10 2004 ou mais novo; num mais antigo, a janela continua aparecendo, e o
/// erro só vai para o log.
pub fn exclude_from_capture(hwnd: usize) {
    let hwnd = HWND(hwnd as *mut _);
    // SAFETY: `hwnd` é a janela principal do app, criada pelo Tauri e viva; um valor inválido só
    // faz a chamada devolver erro.
    if let Err(error) = unsafe { SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) } {
        tracing::warn!(%error, "não deu para tirar a janela do Ashtar das capturas");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn janela_que_nao_existe_nao_vem_para_a_frente() {
        assert!(!bring_to_front(0));
    }
}
