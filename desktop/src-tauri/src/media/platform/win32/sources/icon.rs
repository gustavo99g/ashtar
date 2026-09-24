//! Extração de ícone de janela.
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

/// Ícone da janela como `data:image/png;base64,...`, ou `None` se não houver.
pub fn icon_data_url(hwnd: HWND) -> Option<String> {
    let icon = find_icon(hwnd)?;
    let (width, height, rgba) = icon_pixels(icon)?;
    encode_png_data_url(width, height, rgba)
}

pub fn find_icon(hwnd: HWND) -> Option<HICON> {
    for kind in [ICON_SMALL2, ICON_SMALL, ICON_BIG] {
        if let Some(icon) = ask_window_icon(hwnd, kind) {
            return Some(icon);
        }
    }

    for index in [GCLP_HICONSM, GCLP_HICON] {
        let icon = unsafe { GetClassLongPtrW(hwnd, index) as HICON };
        if !icon.is_null() {
            return Some(icon);
        }
    }

    None
}

fn ask_window_icon(hwnd: HWND, kind: u32) -> Option<HICON> {
    let mut result: usize = 0;
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
    let mut info: ICONINFO = unsafe { mem::zeroed() };

    if unsafe { GetIconInfo(icon, &mut info) } == 0 {
        return None;
    }
    // O GetIconInfo cria dois bitmaps que passam a ser nossos. Os guards os liberam
    // em qualquer saída desta função, inclusive nos `?` e `return None` abaixo.
    let _mask = GdiObject::new(info.hbmMask);
    let color = GdiObject::new(info.hbmColor)?;

    let mut bitmap: BITMAP = unsafe { mem::zeroed() };
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

    let mut header: BITMAPINFO = unsafe { mem::zeroed() };
    header.bmiHeader.biSize = mem::size_of::<BITMAPINFOHEADER>() as u32;
    header.bmiHeader.biWidth = width;
    header.bmiHeader.biHeight = -height; // negativo = linhas de cima para baixo
    header.bmiHeader.biPlanes = 1;
    header.bmiHeader.biBitCount = 32;
    header.bmiHeader.biCompression = BI_RGB as u32;

    let mut pixels = vec![0u8; (width * height * 4) as usize];
    let dc = ScreenDc::new()?;
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
