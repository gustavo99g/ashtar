//! Guards RAII para recursos GDI/Win32 compartilhados por `sources/`.
//!
//! Usados por `icon.rs` (extracao de icone) e `monitor.rs` (`GetMonitorInfoW`).
//! O Windows tem um limite de ~10 mil objetos GDI por processo; sem esses
//! guards, um `return` ou `?` no meio do caminho vazaria bitmaps/DCs. O
//! icone em si (obtido via `WM_GETICON`) nunca deve ser embrulhado aqui:
//! ele pertence a janela, so os bitmaps que o `GetIconInfo` cria a partir
//! dele sao nossos.
use std::ptr;
use windows_sys::Win32::Graphics::Gdi::{DeleteObject, GetDC, ReleaseDC, HDC, HGDIOBJ};

/// Device context da tela inteira. Liberado com `ReleaseDC`.
pub struct ScreenDc(HDC);

impl ScreenDc {
    pub fn new() -> Option<Self> {
        // SAFETY: `GetDC(null)` pede o DC da tela inteira (nao de uma janela
        // especifica); e uma chamada Win32 comum, sem pre-condicoes alem de
        // rodar numa thread com uma estacao de janela valida (garantido pelo
        // processo do app).
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
        // SAFETY: `self.0` veio de `GetDC(null)` em `new` e ainda nao foi
        // liberado (unico `Drop`, sem `Clone`). `ReleaseDC` com o mesmo par
        // (null, hdc) usado no `GetDC` e o uso documentado pela API.
        unsafe { ReleaseDC(ptr::null_mut(), self.0) };
    }
}

/// Objeto GDI que pertence a nos (um bitmap, por exemplo). Liberado com `DeleteObject`.
pub struct GdiObject(HGDIOBJ);

impl GdiObject {
    /// Devolve `None` para handle nulo, entao da para passar direto
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
        // SAFETY: `self.0` e um handle GDI valido e nao-nulo (checado em
        // `new`), que este guard possui com exclusividade (sem `Clone`).
        // `DeleteObject` aceita qualquer objeto GDI que o chamador possua.
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
        // SAFETY: `GetCurrentProcess()` devolve um pseudo-handle valido por
        // definicao (nao precisa ser fechado); `GetGuiResources` so le
        // contadores do processo, sem efeitos colaterais.
        unsafe { GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS) }
    }

    #[test]
    fn nao_vaza_objetos_gdi() {
        let dc = ScreenDc::new().expect("não foi possível obter o DC da tela");
        let antes = gdi_count();

        for _ in 0..1000 {
            // SAFETY: `dc.handle()` e um DC valido (guard vivo); criar um
            // bitmap compativel 16x16 nao tem pre-condicoes alem disso.
            let bitmap = unsafe { CreateCompatibleBitmap(dc.handle(), 16, 16) };
            let _guard = GdiObject::new(bitmap).expect("falha ao criar bitmap");
            // _guard sai de escopo aqui, no fim de cada volta, e libera o bitmap
        }

        assert_eq!(gdi_count(), antes);
    }
}
