//! Declarações e helpers de GDI/Win32 compartilhados por `sources/`.
//!
//! Vazio por enquanto — entra no passo 3/5.
use std::ptr;
use windows_sys::Win32::Graphics::Gdi::{DeleteObject, GetDC, ReleaseDC, HDC, HGDIOBJ};

/// Device context da tela inteira. Liberado com `ReleaseDC`.
pub struct ScreenDc(HDC);

impl ScreenDc {
    pub fn new() -> Option<Self> {
        let hdc = unsafe { GetDC(ptr::null_mut()) };
        if hdc.is_null() {
            None
        } else {
            Some(Self(hdc))
        }
    }

    pub fn handle(&self) -> HDC {
        self.0
    }
}

impl Drop for ScreenDc {
    fn drop(&mut self) {
        unsafe { ReleaseDC(ptr::null_mut(), self.0) };
    }
}
/// Objeto GDI que pertence a nós (um bitmap, por exemplo). Liberado com `DeleteObject`.
pub struct GdiObject(HGDIOBJ);

impl GdiObject {
    /// Devolve `None` para handle nulo, então dá para passar direto
    /// o resultado de uma chamada do Windows.
    pub fn new(handle: HGDIOBJ) -> Option<Self> {
        if handle.is_null() {
            None
        } else {
            Some(Self(handle))
        }
    }

    pub fn handle(&self) -> HGDIOBJ {
        self.0
    }
}

impl Drop for GdiObject {
    fn drop(&mut self) {
        unsafe { DeleteObject(self.0) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::Graphics::Gdi::CreateCompatibleBitmap;
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, GetGuiResources, GR_GDIOBJECTS,
    };

    fn gdi_count() -> u32 {
        unsafe { GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS) }
    }

    #[test]
    fn nao_vaza_objetos_gdi() {
        let dc = ScreenDc::new().expect("não foi possível obter o DC da tela");
        let antes = gdi_count();

        for _ in 0..1000 {
            let bitmap = unsafe { CreateCompatibleBitmap(dc.handle(), 16, 16) };
            let _guard = GdiObject::new(bitmap).expect("falha ao criar bitmap");
            // _guard sai de escopo aqui, no fim de cada volta, e libera o bitmap
        }

        assert_eq!(gdi_count(), antes);
    }
}
