//! Captura de uma tela pelo Windows.Graphics.Capture (WGC), entregando texturas D3D11.
//!
//! O pool é "free threaded": não precisa de laço de mensagens, e o frame mais recente é
//! buscado com `TryGetNextFrame` no ritmo de quem consome. O WGC só produz frame quando a
//! imagem muda; com a tela parada, `latest` devolve `None`.

use windows::core::{factory, Interface, Result};
use windows::Graphics::Capture::{
    Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Graphics::Direct3D11::{ID3D11Device, ID3D11Texture2D};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::Graphics::Gdi::HMONITOR;
use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;

pub struct Capture {
    pool: Direct3D11CaptureFramePool,
    session: GraphicsCaptureSession,
    pub width: u32,
    pub height: u32,
    /// O que o Windows aceitou das opções da sessão (cada uma depende da versão do Windows).
    pub notes: Vec<String>,
}

impl Capture {
    pub fn monitor(device: &ID3D11Device, monitor: HMONITOR) -> Result<Self> {
        if !GraphicsCaptureSession::IsSupported()? {
            return Err(windows::core::Error::new(
                windows::Win32::Foundation::E_NOTIMPL,
                "WGC não suportado neste Windows",
            ));
        }

        let interop = factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
        // SAFETY: `monitor` é um HMONITOR válido vindo do `EnumDisplayMonitors`.
        let item: GraphicsCaptureItem = unsafe { interop.CreateForMonitor(monitor)? };
        let size = item.Size()?;

        // SAFETY: `device` é um ID3D11Device válido; o cast para IDXGIDevice sempre existe.
        let winrt_device: IDirect3DDevice = unsafe {
            let dxgi: IDXGIDevice = device.cast()?;
            CreateDirect3D11DeviceFromDXGIDevice(&dxgi)?.cast()?
        };

        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &winrt_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            size,
        )?;
        let session = pool.CreateCaptureSession(&item)?;

        let mut notes = Vec::new();
        let mut note = |what: &str, result: Result<()>| match result {
            Ok(()) => notes.push(format!("{what}: ok")),
            Err(e) => notes.push(format!("{what}: não suportado ({})", e.message())),
        };
        note("sem borda amarela", session.SetIsBorderRequired(false));
        note("cursor", session.SetIsCursorCaptureEnabled(true));

        session.StartCapture()?;

        Ok(Self {
            pool,
            session,
            width: size.Width as u32,
            height: size.Height as u32,
            notes,
        })
    }

    /// Entrega a `use_frame` o frame mais novo desde a última chamada, descartando os
    /// intermediários, e devolve se havia frame novo (`false` = a imagem não mudou).
    ///
    /// A textura só vale durante `use_frame`: depois o frame volta ao pool e o WGC pode
    /// escrever nela de novo. Por isso quem chama copia ali dentro.
    ///
    /// Devolve `Some(t)` com o horário em que o Windows compôs a imagem (`SystemRelativeTime`,
    /// em unidades de 100 ns no relógio do QueryPerformanceCounter), ou `None` se não mudou.
    pub fn latest(&self, use_frame: impl FnOnce(&ID3D11Texture2D)) -> Result<Option<i64>> {
        let mut newest = None;
        // `TryGetNextFrame` devolve nulo (erro no windows-rs) quando não há frame na fila.
        while let Ok(frame) = self.pool.TryGetNextFrame() {
            if let Some(older) = newest.replace(frame) {
                let _ = older.Close();
            }
        }
        let Some(frame) = newest else {
            return Ok(None);
        };
        let composed = frame.SystemRelativeTime().map_or(0, |t| t.Duration);
        let access: IDirect3DDxgiInterfaceAccess = frame.Surface()?.cast()?;
        // SAFETY: a superfície de um frame do WGC é sempre uma ID3D11Texture2D.
        let texture: ID3D11Texture2D = unsafe { access.GetInterface()? };
        use_frame(&texture);
        let _ = frame.Close();
        Ok(Some(composed))
    }
}

/// Agora, no mesmo relógio do `SystemRelativeTime` (100 ns, QueryPerformanceCounter).
pub fn now_100ns() -> i64 {
    let (mut counter, mut frequency) = (0i64, 0i64);
    // SAFETY: os dois ponteiros apontam para variáveis locais; as chamadas não falham no
    // Windows XP em diante.
    unsafe {
        let _ = QueryPerformanceCounter(&mut counter);
        let _ = QueryPerformanceFrequency(&mut frequency);
    }
    (counter as i128 * 10_000_000 / frequency.max(1) as i128) as i64
}

impl Drop for Capture {
    fn drop(&mut self) {
        let _ = self.session.Close();
        let _ = self.pool.Close();
    }
}
