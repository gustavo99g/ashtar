//! Captura de uma tela ou janela pelo Windows.Graphics.Capture (WGC), entregando texturas D3D11
//! (ADR 0018). Substitui o `DesktopCapturer` do libwebrtc, que não lista nem captura janelas
//! minimizadas e entrega a imagem já na memória.
//!
//! - O pool é "free threaded": não precisa de laço de mensagens, e o frame mais novo é buscado
//!   com `TryGetNextFrame` no ritmo de quem consome ([`WgcCapture::latest`]).
//! - O WGC só produz frame quando a imagem muda. Com a tela parada, ou a janela minimizada,
//!   `latest` devolve `None`, e quem usa decide o que reenviar.
//! - Sem a borda amarela (`IsBorderRequired = false`, no Windows 11) e com o cursor, que pode ser
//!   ligado e desligado no meio ([`WgcCapture::set_cursor`]).
//! - Janela que muda de tamanho: o pool é recriado no tamanho novo, e o frame daquela volta é
//!   descartado. Janela fechada: [`WgcCapture::is_closed`].
//!
//! Vive e morre numa thread só (os objetos COM daqui não são `Send`), que precisa do WinRT
//! inicializado em modo multithread ([`init_thread`]).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use windows::core::{factory, Interface};
use windows::Foundation::{TimeSpan, TypedEventHandler};
use windows::Graphics::Capture::{
    Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Graphics::SizeInt32;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Direct3D11::ID3D11Texture2D;
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::Graphics::Gdi::HMONITOR;
use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
use windows::Win32::UI::WindowsAndMessaging::IsWindow;

use super::gpu::GpuDevice;
use super::hr::hr;
use crate::error::AppError;
use crate::media::sources::SourceRef;

/// Quantos frames o pool guarda. Com 2, o WGC escreve um enquanto o outro é copiado.
const POOL_FRAMES: i32 = 2;
/// O intervalo mínimo entre imagens que [`WgcCapture::allow_full_rate`] pede: 2 ms, abaixo do
/// ciclo de qualquer monitor, para o WGC entregar uma imagem a cada ciclo.
const MIN_UPDATE_INTERVAL_100NS: i64 = 20_000;
const FORMAT: DirectXPixelFormat = DirectXPixelFormat::B8G8R8A8UIntNormalized;

/// Prepara a thread atual para o WGC: WinRT (e COM) em modo multithread.
///
/// Chamar uma vez, no começo da thread que vai criar as capturas. Chamar de novo na mesma thread
/// não faz mal (o Windows só responde que já estava inicializado).
pub fn init_thread() {
    // SAFETY: sem pré-condições; numa thread que já tem o COM em outro modo, só devolve erro, que
    // é ignorado (o WGC funciona nos dois).
    let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
}

/// Agora, no relógio do `SystemRelativeTime` dos frames: unidades de 100 ns do
/// `QueryPerformanceCounter`. O mesmo relógio do horário dos pacotes do WASAPI.
pub fn now_100ns() -> i64 {
    let (mut counter, mut frequency) = (0i64, 0i64);
    // SAFETY: os dois ponteiros apontam para variáveis locais; as duas chamadas não falham do
    // Windows XP em diante.
    unsafe {
        let _ = QueryPerformanceCounter(&mut counter);
        let _ = QueryPerformanceFrequency(&mut frequency);
    }
    (i128::from(counter) * 10_000_000 / i128::from(frequency.max(1))) as i64
}

pub struct WgcCapture {
    device: IDirect3DDevice,
    pool: Direct3D11CaptureFramePool,
    session: GraphicsCaptureSession,
    /// O tamanho do pool, que é o das texturas entregues.
    size: SizeInt32,
    /// Só para janelas: o `HWND`, conferido a cada volta (o aviso de fechada pode não chegar).
    window: Option<HWND>,
    closed: Arc<AtomicBool>,
}

impl WgcCapture {
    /// Começa a capturar `source` no dispositivo `gpu`. Uma janela ou tela que não existe falha
    /// com `SourceNotFound`.
    pub fn new(gpu: &GpuDevice, source: SourceRef, cursor: bool) -> Result<Self, AppError> {
        if !GraphicsCaptureSession::IsSupported().unwrap_or(false) {
            return Err(AppError::VideoCapture(
                "este Windows não tem o Windows.Graphics.Capture".into(),
            ));
        }

        let interop = factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
            .map_err(hr("IGraphicsCaptureItemInterop"))?;
        let (item, window) = match source {
            SourceRef::Window(id) => {
                let hwnd = HWND(id as usize as *mut _);
                // SAFETY: `IsWindow` aceita qualquer valor e só devolve falso para um inválido.
                if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
                    return Err(AppError::SourceNotFound(id));
                }
                // SAFETY: `hwnd` é uma janela que existia agora há pouco; se ela fechou no meio,
                // a chamada falha com erro, sem UB.
                let item: GraphicsCaptureItem = unsafe { interop.CreateForWindow(hwnd) }
                    .map_err(|_| AppError::SourceNotFound(id))?;
                (item, Some(hwnd))
            }
            SourceRef::Monitor(id) => {
                let monitor = HMONITOR(id as usize as *mut _);
                // SAFETY: um `HMONITOR` inválido (a tela foi desligada) faz a chamada falhar com
                // erro, sem UB.
                let item: GraphicsCaptureItem = unsafe { interop.CreateForMonitor(monitor) }
                    .map_err(|_| AppError::SourceNotFound(id))?;
                (item, None)
            }
        };
        let size = item.Size().map_err(hr("GraphicsCaptureItem::Size"))?;

        // SAFETY: o dispositivo é um ID3D11Device válido, e todo dispositivo D3D11 tem o
        // IDXGIDevice; a conversão para o dispositivo do WinRT não guarda ponteiro nenhum nosso.
        let device: IDirect3DDevice = unsafe {
            let dxgi: IDXGIDevice = gpu.device().cast().map_err(hr("IDXGIDevice"))?;
            CreateDirect3D11DeviceFromDXGIDevice(&dxgi)
                .and_then(|inspectable| inspectable.cast())
                .map_err(hr("CreateDirect3D11DeviceFromDXGIDevice"))?
        };

        let pool =
            Direct3D11CaptureFramePool::CreateFreeThreaded(&device, FORMAT, POOL_FRAMES, size)
                .map_err(hr("CreateFreeThreaded"))?;
        let session = pool
            .CreateCaptureSession(&item)
            .map_err(hr("CreateCaptureSession"))?;

        // As duas opções dependem da versão do Windows: sem elas, a captura funciona do mesmo jeito
        // (com a borda amarela, ou sempre com o cursor).
        if let Err(error) = session.SetIsBorderRequired(false) {
            tracing::info!(%error, "este Windows não deixa tirar a borda amarela da captura");
        }
        if let Err(error) = session.SetIsCursorCaptureEnabled(cursor) {
            tracing::info!(%error, "este Windows não deixa escolher o cursor na captura");
        }

        let closed = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&closed);
        item.Closed(&TypedEventHandler::new(move |_, _| {
            flag.store(true, Ordering::Release);
            Ok(())
        }))
        .map_err(hr("GraphicsCaptureItem::Closed"))?;

        session.StartCapture().map_err(hr("StartCapture"))?;

        Ok(Self {
            device,
            pool,
            session,
            size,
            window,
            closed,
        })
    }

    /// O tamanho das texturas entregues agora, em pixels reais (não o lógico de uma tela com
    /// escala de 150%).
    pub fn size(&self) -> (u32, u32) {
        (self.size.Width as u32, self.size.Height as u32)
    }

    /// A janela fechou (ou a tela foi desligada): não vai vir mais nada.
    pub fn is_closed(&self) -> bool {
        if self.closed.load(Ordering::Acquire) {
            return true;
        }
        // SAFETY: `IsWindow` aceita qualquer valor, inclusive o de uma janela que já fechou.
        self.window
            .is_some_and(|hwnd| !unsafe { IsWindow(Some(hwnd)) }.as_bool())
    }

    /// Tira o limite de ~60 imagens por segundo que o Windows põe no WGC.
    ///
    /// Por padrão, as imagens saem com pelo menos ~16,7 ms entre si, e só nos ciclos do monitor:
    /// num monitor de 144 Hz (ciclo de 6,9 ms) isso dá uma imagem a cada 3 ciclos, **48 por
    /// segundo**, e a transmissão não passa disso. Com um intervalo menor, o pipeline (que pega a
    /// imagem mais nova a cada volta) chega aos 60. Precisa do Windows 11 22H2; num mais antigo,
    /// fica o padrão.
    pub fn allow_full_rate(&self) {
        let interval = TimeSpan {
            Duration: MIN_UPDATE_INTERVAL_100NS,
        };
        if let Err(error) = self.session.SetMinUpdateInterval(interval) {
            tracing::info!(%error, "este Windows não deixa tirar o limite de imagens do WGC");
        }
    }

    /// Liga ou desliga o cursor na imagem, no meio da captura.
    pub fn set_cursor(&self, enabled: bool) {
        if let Err(error) = self.session.SetIsCursorCaptureEnabled(enabled) {
            tracing::info!(%error, "não deu para trocar o cursor da captura");
        }
    }

    /// Entrega a `use_frame` o frame mais novo desde a última chamada, descartando os do meio, e
    /// devolve o horário em que o Windows o compôs (`SystemRelativeTime`, no relógio de
    /// [`now_100ns`]). `None`: a imagem não mudou, ou o frame foi descartado porque a janela mudou
    /// de tamanho.
    ///
    /// A textura (BGRA, do tamanho de [`WgcCapture::size`]) só vale durante `use_frame`: depois, o
    /// frame volta ao pool e o WGC escreve nela de novo. Quem chama copia ali dentro.
    pub fn latest(
        &mut self,
        use_frame: impl FnOnce(&ID3D11Texture2D),
    ) -> Result<Option<i64>, AppError> {
        let mut newest = None;
        // `TryGetNextFrame` devolve nulo (um erro, na crate `windows`) quando a fila está vazia.
        while let Ok(frame) = self.pool.TryGetNextFrame() {
            if let Some(older) = newest.replace(frame) {
                let _ = older.Close();
            }
        }
        let Some(frame) = newest else {
            return Ok(None);
        };

        let content = frame.ContentSize().map_err(hr("ContentSize"))?;
        if content.Width != self.size.Width || content.Height != self.size.Height {
            // A janela mudou de tamanho: o pool passa a ter o tamanho novo, e este frame (ainda
            // no tamanho antigo, com sobra ou cortado) fica de fora.
            let _ = frame.Close();
            if content.Width > 0 && content.Height > 0 {
                self.pool
                    .Recreate(&self.device, FORMAT, POOL_FRAMES, content)
                    .map_err(hr("Recreate"))?;
                self.size = content;
            }
            return Ok(None);
        }

        let composed = frame
            .SystemRelativeTime()
            .map_or_else(|_| now_100ns(), |t| t.Duration);
        let texture: ID3D11Texture2D = frame
            .Surface()
            .and_then(|surface| surface.cast::<IDirect3DDxgiInterfaceAccess>())
            // SAFETY: a superfície de um frame do WGC é sempre uma ID3D11Texture2D.
            .and_then(|access| unsafe { access.GetInterface() })
            .map_err(hr("IDirect3DDxgiInterfaceAccess"))?;
        use_frame(&texture);
        let _ = frame.Close();
        Ok(Some(composed))
    }
}

impl Drop for WgcCapture {
    fn drop(&mut self) {
        let _ = self.session.Close();
        let _ = self.pool.Close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    use crate::media::platform::list_monitors;

    /// Captura `source` por `seconds` segundos e devolve quantas imagens novas chegaram, ou
    /// `None` se a fonte fechou no meio.
    fn count_frames(source: SourceRef, seconds: u64) -> Option<u32> {
        init_thread();
        let gpu = GpuDevice::new().expect("dispositivo");
        let mut capture = WgcCapture::new(&gpu, source, true).expect("a captura deveria começar");
        // Como o pipeline faz: sem isto, um monitor de 144 Hz entrega só 48 imagens por segundo.
        if std::env::var("WGC_CAPPED").is_err() {
            capture.allow_full_rate();
        }
        println!("tamanho: {:?}", capture.size());
        let (mut frames, mut last) = (0, None);
        let until = Instant::now() + Duration::from_secs(seconds);
        while Instant::now() < until {
            if capture.is_closed() {
                return None;
            }
            if let Some(time) = capture.latest(|_| {}).expect("latest") {
                assert!(last.is_none_or(|last| time >= last), "o horário voltou");
                last = Some(time);
                frames += 1;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        Some(frames)
    }

    #[test]
    #[ignore = "precisa de uma área de trabalho real"]
    fn captura_a_tela_principal() {
        let primary = list_monitors()
            .into_iter()
            .find(|m| m.info.is_primary)
            .expect("nenhuma tela principal");
        let frames = count_frames(SourceRef::Monitor(primary.id), 5).expect("a tela não fecha");
        println!("{frames} imagens novas em 5 s (mexa o mouse para ver o número subir)");
        assert!(frames > 0);
    }

    #[test]
    #[ignore = "precisa de CAPTURE_WINDOW com o id de uma janela (o `id` do seletor)"]
    fn captura_uma_janela_ate_fechar() {
        let id: u64 = std::env::var("CAPTURE_WINDOW")
            .expect("defina CAPTURE_WINDOW")
            .parse()
            .expect("CAPTURE_WINDOW deve ser um número");
        // Durante os 20 s: redimensione, minimize e restaure a janela, e no fim feche-a.
        match count_frames(SourceRef::Window(id), 20) {
            Some(frames) => println!("{frames} imagens novas; a janela continuou aberta"),
            None => println!("a janela fechou e a captura percebeu"),
        }
    }

    #[test]
    #[ignore = "precisa de uma área de trabalho real"]
    fn fonte_inexistente_falha_ao_comecar() {
        init_thread();
        let gpu = GpuDevice::new().expect("dispositivo");
        let result = WgcCapture::new(&gpu, SourceRef::Window(0), true);
        assert!(matches!(result, Err(AppError::SourceNotFound(0))));
    }
}
