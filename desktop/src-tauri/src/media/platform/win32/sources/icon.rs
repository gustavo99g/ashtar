//! Extracao de icone de janela para `data:image/png;base64,...`.
//!
//! Usado por `window.rs` para enriquecer cada `CaptureSource`. O icone e
//! dado estatico de identificacao da fonte (nao miniatura ao vivo do
//! conteudo), entao um icone por janela, buscado uma vez na listagem, basta.
use std::{ffi::c_void, io::Cursor, mem};

use base64::{engine::general_purpose::STANDARD, Engine};
use image::{ImageFormat, RgbaImage};
use windows_sys::Win32::{
    Foundation::HWND,
    Graphics::Gdi::{
        GetDIBits, GetObjectW, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    },
    UI::WindowsAndMessaging::{
        GetClassLongPtrW, GetIconInfo, SendMessageTimeoutW, GCLP_HICON, GCLP_HICONSM, HICON,
        ICONINFO, ICON_BIG, ICON_SMALL, ICON_SMALL2, SMTO_ABORTIFHUNG, WM_GETICON,
    },
};

use super::gdi::{GdiObject, ScreenDc};

/// Icone da janela como `data:image/png;base64,...`, ou `None` se nao houver.
///
/// # Bloqueia
///
/// `find_icon` pode esperar ate 50ms por janela que nao responde (veja
/// `ask_window_icon`). Chamar dentro de `spawn_blocking`.
pub fn icon_data_url(hwnd: HWND) -> Option<String> {
    let icon = find_icon(hwnd)?;
    let (width, height, rgba) = icon_pixels(icon)?;
    encode_png_data_url(width, height, rgba)
}

/// # Bloqueia
///
/// Ate 50ms por tentativa de `WM_GETICON` (veja `ask_window_icon`).
pub fn find_icon(hwnd: HWND) -> Option<HICON> {
    for kind in [ICON_SMALL2, ICON_SMALL, ICON_BIG] {
        if let Some(icon) = ask_window_icon(hwnd, kind) {
            return Some(icon);
        }
    }

    for index in [GCLP_HICONSM, GCLP_HICON] {
        // SAFETY: `hwnd` e um HWND recebido do chamador (originado do
        // DesktopCapturer); `GetClassLongPtrW` e uma leitura segura mesmo se
        // a janela ja tiver sido fechada nesse meio-tempo (devolve 0).
        let icon = unsafe { GetClassLongPtrW(hwnd, index) as HICON };
        if !icon.is_null() {
            return Some(icon);
        }
    }

    None
}

/// Pede o icone da janela via `WM_GETICON`, com timeout.
///
/// # Bloqueia
///
/// `SendMessageTimeoutW` com `SMTO_ABORTIFHUNG` e 50ms: espera a janela
/// responder a mensagem, ou desiste se ela estiver travada (nao trava o
/// chamador indefinidamente, mas ainda e uma espera sincrona).
fn ask_window_icon(hwnd: HWND, kind: u32) -> Option<HICON> {
    let mut result: usize = 0;
    // SAFETY: `hwnd` e um HWND valido (ou, na pior hipotese, uma janela
    // fechada — `SendMessageTimeoutW` so retorna 0 nesse caso, sem UB).
    // `result` e um `usize` estatico, `SendMessageTimeoutW` so escreve nele
    // quando `ok != 0`.
    let ok = unsafe {
        SendMessageTimeoutW(
            hwnd,
            WM_GETICON,
            kind as usize,
            0,
            SMTO_ABORTIFHUNG,
            50,
            &mut result,
        )
    };

    if ok == 0 || result == 0 {
        None
    } else {
        Some(result as HICON)
    }
}

fn icon_pixels(icon: HICON) -> Option<(u32, u32, Vec<u8>)> {
    // SAFETY: `ICONINFO` e um struct `#[repr(C)]` só com campos primitivos e
    // handles; todo-zero e um estado valido para passar a `GetIconInfo`
    // (que preenche todos os campos antes de retornar sucesso).
    let mut info: ICONINFO = unsafe { mem::zeroed() };

    // SAFETY: `icon` veio de `find_icon` (WM_GETICON ou GetClassLongPtrW),
    // handle valido de icone; `&mut info` e um `ICONINFO` valido para
    // escrita do tamanho certo.
    if unsafe { GetIconInfo(icon, &mut info) } == 0 {
        return None;
    }
    // O GetIconInfo cria dois bitmaps que passam a ser nossos. Os guards os liberam
    // em qualquer saída desta função, inclusive nos `?` e `return None` abaixo.
    let _mask = GdiObject::new(info.hbmMask);
    let color = GdiObject::new(info.hbmColor)?;

    // SAFETY: `BITMAP` e `#[repr(C)]` com campos primitivos/ponteiro;
    // todo-zero e valido como buffer de saida para `GetObjectW`.
    let mut bitmap: BITMAP = unsafe { mem::zeroed() };
    // SAFETY: `color.handle()` e um HBITMAP valido (guard vivo); `&mut
    // bitmap` tem exatamente `size_of::<BITMAP>()` bytes, o tamanho que
    // passamos.
    let got = unsafe {
        GetObjectW(
            color.handle(),
            mem::size_of::<BITMAP>() as i32,
            &mut bitmap as *mut BITMAP as *mut c_void,
        )
    };
    if got == 0 || bitmap.bmWidth <= 0 || bitmap.bmHeight <= 0 {
        return None;
    }

    let (width, height) = (bitmap.bmWidth, bitmap.bmHeight);

    // SAFETY: `BITMAPINFO` e `#[repr(C)]`; todo-zero e valido, os campos
    // relevantes sao preenchidos logo abaixo antes de qualquer uso.
    let mut header: BITMAPINFO = unsafe { mem::zeroed() };
    header.bmiHeader.biSize = mem::size_of::<BITMAPINFOHEADER>() as u32;
    header.bmiHeader.biWidth = width;
    header.bmiHeader.biHeight = -height; // negativo = linhas de cima para baixo
    header.bmiHeader.biPlanes = 1;
    header.bmiHeader.biBitCount = 32;
    header.bmiHeader.biCompression = BI_RGB as u32;

    let mut pixels = vec![0u8; (width * height * 4) as usize];
    let dc = ScreenDc::new()?;
    // SAFETY: `dc.handle()` e um DC valido; `color.handle()` e o HBITMAP
    // (32bpp, `width`x`height` conforme `header`); `pixels` tem exatamente
    // `width * height * 4` bytes, o tamanho que `header` descreve.
    let lines = unsafe {
        GetDIBits(
            dc.handle(),
            color.handle(),
            0,
            height as u32,
            pixels.as_mut_ptr() as *mut c_void,
            &mut header,
            DIB_RGB_COLORS,
        )
    };
    if lines == 0 {
        return None;
    }
    // O Windows entrega BGRA; a biblioteca de imagem espera RGBA.
    for p in pixels.chunks_exact_mut(4) {
        p.swap(0, 2);
    }
    // Ícones antigos não têm transparência e vêm com alfa zero em tudo.
    if pixels.chunks_exact(4).all(|p| p[3] == 0) {
        for p in pixels.chunks_exact_mut(4) {
            p[3] = 255;
        }
    }
    Some((width as u32, height as u32, pixels))
}

fn encode_png_data_url(width: u32, height: u32, rgba: Vec<u8>) -> Option<String> {
    let image = RgbaImage::from_raw(width, height, rgba)?;
    let mut png = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .ok()?;

    Some(format!("data:image/png;base64,{}", STANDARD.encode(png)))
}
