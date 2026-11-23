//! Uma imagem na área de transferência do Windows (decisão 24 do plano da v0.8): em `CF_DIB`, que
//! todo programa entende, e em `PNG`, que os navegadores e os chats preferem (guarda a
//! transparência e não perde nada).

use windows_sys::Win32::Foundation::{GlobalFree, HWND};
use windows_sys::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

use crate::error::AppError;

/// O formato padrão do Windows para um bitmap com o cabeçalho na frente.
const CF_DIB: u32 = 8;

/// A área de transferência aberta, fechada ao sair do escopo.
struct Open;

impl Open {
    fn new(owner: HWND) -> Result<Self, AppError> {
        // Outro programa pode estar com ela aberta por um instante: tenta algumas vezes.
        for _ in 0..10 {
            // SAFETY: `owner` é a janela principal do app (ou nulo); sem outras pré-condições.
            if unsafe { OpenClipboard(owner) } != 0 {
                return Ok(Self);
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        Err(AppError::Internal(
            "a área de transferência está ocupada".into(),
        ))
    }
}

impl Drop for Open {
    fn drop(&mut self) {
        // SAFETY: só existe depois de um `OpenClipboard` que deu certo.
        unsafe { CloseClipboard() };
    }
}

/// Copia `bytes` para um bloco do `GlobalAlloc` e o entrega à área de transferência.
fn set(format: u32, bytes: &[u8]) -> Result<(), AppError> {
    let fail = |what: &str| AppError::Internal(format!("área de transferência: {what}"));
    // SAFETY: tamanho positivo; o bloco é só nosso até o `SetClipboardData`.
    let block = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1)) };
    if block.is_null() {
        return Err(fail("sem memória"));
    }
    // SAFETY: `block` veio do `GlobalAlloc` acima, com `bytes.len()` bytes; o ponteiro só é usado
    // entre o `GlobalLock` e o `GlobalUnlock`.
    unsafe {
        let target = GlobalLock(block).cast::<u8>();
        if target.is_null() {
            GlobalFree(block);
            return Err(fail("GlobalLock"));
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), target, bytes.len());
        GlobalUnlock(block);
    }
    // SAFETY: a área de transferência está aberta (`Open`); dando certo, o Windows passa a ser o
    // dono do bloco, e ele não pode mais ser liberado aqui.
    if unsafe { SetClipboardData(format, block) }.is_null() {
        // SAFETY: o Windows não ficou com o bloco.
        unsafe { GlobalFree(block) };
        return Err(fail("SetClipboardData"));
    }
    Ok(())
}

/// Põe a imagem na área de transferência: `dib` é um `BITMAPINFOHEADER` seguido dos pixels, e
/// `png` o mesmo em PNG. `owner` é a janela do app (o Windows pede uma para o `EmptyClipboard`).
pub fn copy_image(owner: usize, dib: &[u8], png: &[u8]) -> Result<(), AppError> {
    let _open = Open::new(owner as HWND)?;
    // SAFETY: a área de transferência está aberta por este processo.
    if unsafe { EmptyClipboard() } == 0 {
        return Err(AppError::Internal(
            "não deu para limpar a área de transferência".into(),
        ));
    }
    set(CF_DIB, dib)?;
    let name: Vec<u16> = "PNG".encode_utf16().chain(Some(0)).collect();
    // SAFETY: o texto termina em zero.
    let png_format = unsafe { RegisterClipboardFormatW(name.as_ptr()) };
    if png_format != 0 {
        // O PNG é um extra: sem ele, o DIB já serve.
        let _ = set(png_format, png);
    }
    Ok(())
}
