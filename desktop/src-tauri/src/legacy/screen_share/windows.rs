use base64::{engine::general_purpose::STANDARD, Engine};
use image::{codecs::jpeg::JpegEncoder, DynamicImage, ImageFormat, RgbaImage};
use std::{
    error::Error,
    ffi::c_void,
    mem::size_of,
    ptr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::ipc::{Channel, InvokeResponseBody};
use tracing::debug;
use windows_capture::{
    capture::{Context, GraphicsCaptureApiHandler},
    frame::Frame,
    graphics_capture_api::InternalCaptureControl,
    monitor::Monitor,
    settings::{
        ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
        MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
    },
    window::Window,
};

use fast_image_resize::{images::Image, FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};

type Hwnd = isize;
type Hmonitor = isize;
type Hdc = isize;
type Lparam = isize;
type Bool = i32;

#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[repr(C)]
struct MonitorInfoExW {
    cb_size: u32,
    rc_monitor: Rect,
    rc_work: Rect,
    dw_flags: u32,
    sz_device: [u16; 32],
}

const MONITORINFOF_PRIMARY: u32 = 0x0000_0001;

type EnumWindowsProc = Option<unsafe extern "system" fn(Hwnd, Lparam) -> Bool>;

type EnumDisplayMonitorsProc =
    Option<unsafe extern "system" fn(Hmonitor, Hdc, *const Rect, Lparam) -> Bool>;

use super::{MonitorSource, PreviewSourceType, WindowPreviewFrame, WindowSource};

pub enum ScreenShareVideoSource {
    Window(u64),
    Monitor(u64),
}

#[derive(Clone)]
pub struct WindowPreviewFlags {
    pub source_id: u64,
    pub source_type: PreviewSourceType,
    pub channel: Channel<WindowPreviewFrame>,
    pub stop: Arc<AtomicBool>,
}

pub struct ScreenShareVideoFlags {
    pub channel: Channel<InvokeResponseBody>,
    pub stop: Arc<AtomicBool>,
}

pub struct ScreenShareVideoCapture {
    stop: Arc<AtomicBool>,
    latest: Arc<LatestFrame>,
    frame_count: u64,
    last_fps_log: Instant,
}

struct CapturedFrame {
    data: Vec<u8>,
    width: u32,
    height: u32,
}

struct LatestFrame {
    data: Mutex<Option<CapturedFrame>>,
    condvar: Condvar,
}

pub struct WindowPreviewCapture {
    source_id: u64,
    source_type: PreviewSourceType,
    channel: Channel<WindowPreviewFrame>,
    stop: Arc<AtomicBool>,
    last_frame: Option<Instant>,
}

impl GraphicsCaptureApiHandler for WindowPreviewCapture {
    type Flags = WindowPreviewFlags;
    type Error = Box<dyn Error + Send + Sync>;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self {
            source_id: ctx.flags.source_id,
            source_type: ctx.flags.source_type,
            channel: ctx.flags.channel,
            stop: ctx.flags.stop,
            last_frame: None,
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        if self.stop.load(Ordering::Relaxed) {
            capture_control.stop();
            return Ok(());
        }

        if let Some(last_frame) = self.last_frame {
            if last_frame.elapsed() < Duration::from_millis(500) {
                return Ok(());
            }
        }

        self.last_frame = Some(Instant::now());

        let mut raw_buffer = Vec::new();
        let buffer = frame.buffer()?;

        let width = buffer.width();
        let height = buffer.height();

        let raw = buffer.as_nopadding_buffer(&mut raw_buffer);

        let image = RgbaImage::from_raw(width, height, raw.to_vec())
            .ok_or("Não foi possivel criar a imagem RGBA")?;

        let image = DynamicImage::ImageRgba8(image).to_rgb8();

        let thumbnail = image::imageops::thumbnail(&image, 480, 270);
        let mut jpeg = Vec::new();

        DynamicImage::ImageRgb8(thumbnail)
            .write_to(&mut std::io::Cursor::new(&mut jpeg), ImageFormat::Jpeg)?;

        self.channel
            .send(WindowPreviewFrame {
                source_id: self.source_id,
                source_type: self.source_type,
                mime_type: "image/jpeg".to_string(),
                data: jpeg,
            })
            .map_err(|error| Box::<dyn Error + Send + Sync>::from(error))?;

        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        self.stop.store(true, Ordering::Relaxed);
        Ok(())
    }
}

impl GraphicsCaptureApiHandler for ScreenShareVideoCapture {
    type Flags = ScreenShareVideoFlags;
    type Error = Box<dyn Error + Send + Sync>;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        let latest = Arc::new(LatestFrame::new());
        let stop = ctx.flags.stop.clone();
        let channel = ctx.flags.channel.clone();

        spawn_frame_worker(latest.clone(), stop.clone(), channel);

        Ok(Self {
            stop,
            latest,
            frame_count: 0,
            last_fps_log: Instant::now(),
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        if self.stop.load(Ordering::Relaxed) {
            capture_control.stop();
            return Ok(());
        }

        self.frame_count += 1;

        if self.last_fps_log.elapsed() >= Duration::from_secs(1) {
            debug!(target: "perf", fps = self.frame_count, "WGC FPS");

            self.frame_count = 0;
            self.last_fps_log = Instant::now();
        }

        let buffer = frame.buffer()?;

        let width = buffer.width();
        let height = buffer.height();

        let mut raw_buffer = Vec::new();

        let raw = buffer.as_nopadding_buffer(&mut raw_buffer);

        self.latest.push(CapturedFrame {
            data: raw.to_vec(),
            width,
            height,
        });

        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        self.stop.store(true, Ordering::Relaxed);
        self.latest.wake();
        Ok(())
    }
}

fn spawn_frame_worker(
    latest: Arc<LatestFrame>,
    stop: Arc<AtomicBool>,
    channel: Channel<InvokeResponseBody>,
) {
    thread::Builder::new()
        .name("video-frame-worker".into())
        .spawn(move || {
            let mut resizer = Resizer::new();

            let mut frame_count = 0u32;
            let mut last_fps_log = Instant::now();

            loop {
                let Some(frame) = latest.take(&stop) else {
                    break;
                };

                let Some(payload) = process_frame(frame, &mut resizer) else {
                    continue;
                };

                if channel.send(InvokeResponseBody::Raw(payload)).is_err() {
                    stop.store(true, Ordering::Relaxed);
                    latest.wake();
                    break;
                }

                frame_count += 1;

                if last_fps_log.elapsed() >= Duration::from_secs(1) {
                    debug!(target: "perf", fps = frame_count, "VIDEO IPC FPS");

                    frame_count = 0;
                    last_fps_log = Instant::now();
                }
            }

            tracing::info!("frame worker encerrado");
        })
        .expect("falha ao criar thread video-frame-worker");
}
fn process_frame(frame: CapturedFrame, resizer: &mut Resizer) -> Option<Vec<u8>> {
    let (dst_width, dst_height) = target_resolution(frame.width, frame.height);

    let source = Image::from_vec_u8(frame.width, frame.height, frame.data, PixelType::U8x4).ok()?;

    let mut destination = Image::new(dst_width, dst_height, PixelType::U8x4);

    let options = ResizeOptions::new()
        .resize_alg(ResizeAlg::Nearest)
        .use_alpha(false);

    resizer
        .resize(&source, &mut destination, Some(&options))
        .ok()?;

    let resized = destination.into_vec();

    let mut payload = Vec::with_capacity(8 + resized.len());

    payload.extend_from_slice(&dst_width.to_le_bytes());

    payload.extend_from_slice(&dst_height.to_le_bytes());

    payload.extend_from_slice(&resized);

    Some(payload)
}

fn target_resolution(width: u32, height: u32) -> (u32, u32) {
    const MAX_WIDTH: u32 = 1280;
    const MAX_HEIGHT: u32 = 720;

    if width <= MAX_WIDTH && height <= MAX_HEIGHT {
        return (width, height);
    }

    let scale_x = MAX_WIDTH as f64 / width as f64;

    let scale_y = MAX_HEIGHT as f64 / height as f64;

    let scale = scale_x.min(scale_y);

    let mut new_width = (width as f64 * scale).round() as u32;

    let mut new_height = (height as f64 * scale).round() as u32;

    // Dimensões pares são mais amigáveis
    // aos encoders de vídeo.
    new_width &= !1;
    new_height &= !1;

    (new_width.max(2), new_height.max(2))
}

pub fn stream_screen_share_video(
    source: ScreenShareVideoSource,
    channel: Channel<InvokeResponseBody>,
    stop: Arc<AtomicBool>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let flags = ScreenShareVideoFlags { channel, stop };

    match source {
        ScreenShareVideoSource::Window(source_id) => {
            let hwnd = source_id as usize as *mut c_void;

            let window = Window::from_raw_hwnd(hwnd);

            let settings = Settings::new(
                window,
                CursorCaptureSettings::WithoutCursor,
                DrawBorderSettings::WithoutBorder,
                SecondaryWindowSettings::Default,
                MinimumUpdateIntervalSettings::Default,
                DirtyRegionSettings::Default,
                ColorFormat::Rgba8,
                flags,
            );
            ScreenShareVideoCapture::start(settings)?;
        }

        ScreenShareVideoSource::Monitor(source_id) => {
            let hmonitor = source_id as usize as *mut c_void;

            let monitor = Monitor::from_raw_hmonitor(hmonitor);

            let settings = Settings::new(
                monitor,
                CursorCaptureSettings::WithoutCursor,
                DrawBorderSettings::WithoutBorder,
                SecondaryWindowSettings::Default,
                MinimumUpdateIntervalSettings::Default,
                DirtyRegionSettings::Default,
                ColorFormat::Rgba8,
                flags,
            );

            ScreenShareVideoCapture::start(settings)?;
        }
    }

    Ok(())
}
pub fn stream_window_preview(
    source_id: u64,
    channel: Channel<WindowPreviewFrame>,
    stop: Arc<AtomicBool>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let hwnd = source_id as isize as *mut c_void;

    let window = Window::from_raw_hwnd(hwnd);

    let flags = WindowPreviewFlags {
        source_id,
        channel,
        source_type: PreviewSourceType::Window,
        stop,
    };

    let settings = Settings::new(
        window,
        CursorCaptureSettings::WithoutCursor,
        DrawBorderSettings::WithoutBorder,
        SecondaryWindowSettings::Include,
        MinimumUpdateIntervalSettings::Custom(Duration::from_millis(500)),
        DirtyRegionSettings::Default,
        ColorFormat::Rgba8,
        flags,
    );

    WindowPreviewCapture::start(settings)?;

    Ok(())
}

pub fn stream_monitor_preview(
    source_id: u64,
    channel: Channel<WindowPreviewFrame>,
    stop: Arc<AtomicBool>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let hmonitor = source_id as isize as *mut c_void;

    let monitor = Monitor::from_raw_hmonitor(hmonitor);

    let flags = WindowPreviewFlags {
        source_id,
        source_type: PreviewSourceType::Monitor,
        channel,
        stop,
    };

    let settings = Settings::new(
        monitor,
        CursorCaptureSettings::WithoutCursor,
        DrawBorderSettings::WithoutBorder,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Custom(Duration::from_millis(500)),
        DirtyRegionSettings::Default,
        ColorFormat::Rgba8,
        flags,
    );

    WindowPreviewCapture::start(settings)?;

    Ok(())
}

const DWMWA_CLOAKED: u32 = 14;

#[link(name = "dwmapi")]
unsafe extern "system" {
    fn DwmGetWindowAttribute(
        hwnd: Hwnd,
        dw_attribute: u32,
        pv_attribute: *mut std::ffi::c_void,
        cb_attribute: u32,
    ) -> i32;
}
unsafe extern "system" {
    fn EnumWindows(lp_enum_func: EnumWindowsProc, l_param: Lparam) -> Bool;

    fn IsWindowVisible(hwnd: Hwnd) -> Bool;

    fn GetWindowTextLengthW(hwnd: Hwnd) -> i32;

    fn GetWindowTextW(hwnd: Hwnd, lp_string: *mut u16, n_max_count: i32) -> i32;

    fn GetWindowThreadProcessId(hwnd: Hwnd, process_id: *mut u32) -> u32;

    fn EnumDisplayMonitors(
        hdc: Hdc,
        lprc_clip: *const Rect,
        lpfn_enum_proc: EnumDisplayMonitorsProc,
        dw_data: Lparam,
    ) -> Bool;

    fn GetMonitorInfoW(h_monitor: Hmonitor, lpmi: *mut MonitorInfoExW) -> Bool;
}

unsafe extern "system" fn enum_window_callback(hwnd: Hwnd, l_param: Lparam) -> Bool {
    let windows = unsafe { &mut *(l_param as *mut Vec<WindowSource>) };

    if unsafe { IsWindowVisible(hwnd) } == 0 {
        return 1;
    }

    if is_window_cloaked(hwnd) {
        return 1;
    }

    if is_tool_window(hwnd) {
        return 1;
    }

    let title_length = unsafe { GetWindowTextLengthW(hwnd) };

    if title_length <= 0 {
        return 1;
    }

    let mut title_buffer = vec![0u16; (title_length + 1) as usize];

    let title_length =
        unsafe { GetWindowTextW(hwnd, title_buffer.as_mut_ptr(), title_buffer.len() as i32) };

    if title_length <= 0 {
        return 1;
    }

    let title = String::from_utf16_lossy(&title_buffer[..title_length as usize]);

    let mut process_id = 0u32;

    unsafe {
        GetWindowThreadProcessId(hwnd, &mut process_id);
    }

    if process_id == 0 {
        return 1;
    }

    let icon = get_window_icon(hwnd);

    windows.push(WindowSource {
        id: hwnd as u64,
        title,
        process_id,
        icon,
    });

    1
}

unsafe extern "system" fn enum_monitor_callback(
    hmonitor: Hmonitor,
    _hdc: Hdc,
    _rect: *const Rect,
    l_param: Lparam,
) -> Bool {
    let monitors = unsafe { &mut *(l_param as *mut Vec<MonitorSource>) };

    let mut info = MonitorInfoExW {
        cb_size: size_of::<MonitorInfoExW>() as u32,
        rc_monitor: Rect {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        },
        rc_work: Rect {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        },
        dw_flags: 0,
        sz_device: [0; 32],
    };

    let success = unsafe { GetMonitorInfoW(hmonitor, &mut info) };

    if success == 0 {
        return 1;
    }

    let name_length = info
        .sz_device
        .iter()
        .position(|&value| value == 0)
        .unwrap_or(info.sz_device.len());

    let name = String::from_utf16_lossy(&info.sz_device[..name_length]);

    monitors.push(MonitorSource {
        id: hmonitor as u64,
        name,
        x: info.rc_monitor.left,
        y: info.rc_monitor.top,
        width: info.rc_monitor.right - info.rc_monitor.left,
        height: info.rc_monitor.bottom - info.rc_monitor.top,
        is_primary: (info.dw_flags & MONITORINFOF_PRIMARY) != 0,
    });

    1
}

pub fn list_monitors() -> Result<Vec<MonitorSource>, String> {
    let mut monitors = Vec::<MonitorSource>::new();

    let result = unsafe {
        EnumDisplayMonitors(
            0,
            ptr::null(),
            Some(enum_monitor_callback),
            &mut monitors as *mut Vec<MonitorSource> as Lparam,
        )
    };

    if result == 0 {
        return Err("EnumDisplayMonitors falhou.".to_string());
    }

    Ok(monitors)
}

pub fn list_windows() -> Result<Vec<WindowSource>, String> {
    let mut windows = Vec::<WindowSource>::new();

    let result = unsafe {
        EnumWindows(
            Some(enum_window_callback),
            &mut windows as *mut Vec<WindowSource> as isize,
        )
    };

    if result == 0 {
        return Err("EnumWindows falhou.".to_string());
    }

    Ok(windows)
}

fn is_window_cloaked(hwnd: Hwnd) -> bool {
    let mut cloaked = 0u32;

    let result = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut std::ffi::c_void,
            size_of::<u32>() as u32,
        )
    };

    result == 0 && cloaked != 0
}

const GWL_EXSTYLE: i32 = -20;
const WS_EX_TOOLWINDOW: isize = 0x0000_0080;

#[link(name = "user32")]
unsafe extern "system" {
    fn GetWindowLongPtrW(hwnd: Hwnd, index: i32) -> isize;
}

fn is_tool_window(hwnd: Hwnd) -> bool {
    let ex_style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };

    ex_style & WS_EX_TOOLWINDOW != 0
}

const PW_RENDERFULLCONTENT: u32 = 0x0000_0002;
const DIB_RGB_COLORS: u32 = 0;
const BI_RGB: u32 = 0;

const WM_GETICON: u32 = 0x007F;

const ICON_BIG: usize = 1;
const ICON_SMALL: usize = 0;
const ICON_SMALL2: usize = 2;

const GCLP_HICON: i32 = -14;
const GCLP_HICONSM: i32 = -34;

#[repr(C)]
struct IconInfo {
    f_icon: Bool,
    x_hotspot: u32,
    y_hotspot: u32,
    hbm_mask: isize,
    hbm_color: isize,
}

#[repr(C)]
struct Bitmap {
    bm_type: i32,
    bm_width: i32,
    bm_height: i32,
    bm_width_bytes: i32,
    bm_planes: u16,
    bm_bits_pixel: u16,
    bm_bits: *mut c_void,
}

#[link(name = "user32")]
unsafe extern "system" {
    fn SendMessageW(hwnd: Hwnd, msg: u32, w_param: usize, l_param: isize) -> isize;

    fn GetClassLongPtrW(hwnd: Hwnd, index: i32) -> usize;

    fn GetIconInfo(h_icon: isize, icon_info: *mut IconInfo) -> Bool;
}

#[link(name = "gdi32")]
unsafe extern "system" {
    fn GetObjectW(object: isize, count: i32, object_data: *mut c_void) -> i32;

    fn DeleteObject(object: isize) -> Bool;
}

#[repr(C)]
#[derive(Clone, Copy)]
struct BitmapInfoHeader {
    bi_size: u32,
    bi_width: i32,
    bi_height: i32,
    bi_planes: u16,
    bi_bit_count: u16,
    bi_compression: u32,
    bi_size_image: u32,
    bi_x_pels_per_meter: i32,
    bi_y_pels_per_meter: i32,
    bi_clr_used: u32,
    bi_clr_important: u32,
}

#[repr(C)]
struct BitmapInfo {
    bmi_header: BitmapInfoHeader,
    bmi_colors: [u32; 1],
}

#[link(name = "user32")]
unsafe extern "system" {
    fn PrintWindow(hwnd: Hwnd, hdc: Hdc, flags: u32) -> Bool;

    fn GetWindowRect(hwnd: Hwnd, rect: *mut Rect) -> Bool;

    fn GetDC(hwnd: Hwnd) -> Hdc;

    fn ReleaseDC(hwnd: Hwnd, hdc: Hdc) -> i32;
}

#[link(name = "gdi32")]
unsafe extern "system" {
    fn CreateCompatibleDC(hdc: Hdc) -> Hdc;

    fn CreateCompatibleBitmap(hdc: Hdc, width: i32, height: i32) -> isize;

    fn SelectObject(hdc: Hdc, object: isize) -> isize;

    fn DeleteDC(hdc: Hdc) -> Bool;

    fn GetDIBits(
        hdc: Hdc,
        bitmap: isize,
        start: u32,
        lines: u32,
        bits: *mut c_void,
        info: *mut BitmapInfo,
        usage: u32,
    ) -> i32;
}

fn get_window_icon(hwnd: Hwnd) -> Option<String> {
    let icon = unsafe {
        let mut icon = SendMessageW(hwnd, WM_GETICON, ICON_SMALL2, 0);

        if icon == 0 {
            icon = SendMessageW(hwnd, WM_GETICON, ICON_SMALL, 0);
        }

        if icon == 0 {
            icon = SendMessageW(hwnd, WM_GETICON, ICON_BIG, 0);
        }

        if icon == 0 {
            icon = GetClassLongPtrW(hwnd, GCLP_HICONSM) as isize;
        }

        if icon == 0 {
            icon = GetClassLongPtrW(hwnd, GCLP_HICON) as isize;
        }

        icon
    };

    if icon == 0 {
        return None;
    }

    icon_to_data_url(icon).ok()
}

fn icon_to_data_url(h_icon: isize) -> Result<String, Box<dyn Error + Send + Sync>> {
    let mut icon_info = IconInfo {
        f_icon: 1,
        x_hotspot: 0,
        y_hotspot: 0,
        hbm_mask: 0,
        hbm_color: 0,
    };

    let success = unsafe { GetIconInfo(h_icon, &mut icon_info) };

    if success == 0 {
        return Err("GetIconInfo falhou.".into());
    }

    let result = (|| {
        if icon_info.hbm_color == 0 {
            return Err("Ícone não possui bitmap de cor.".into());
        }

        let mut bitmap = Bitmap {
            bm_type: 0,
            bm_width: 0,
            bm_height: 0,
            bm_width_bytes: 0,
            bm_planes: 0,
            bm_bits_pixel: 0,
            bm_bits: ptr::null_mut(),
        };

        let result = unsafe {
            GetObjectW(
                icon_info.hbm_color,
                size_of::<Bitmap>() as i32,
                &mut bitmap as *mut Bitmap as *mut c_void,
            )
        };

        if result == 0 {
            return Err("Não foi possível obter o bitmap do ícone.".into());
        }

        let width = bitmap.bm_width;
        let height = bitmap.bm_height;

        if width <= 0 || height <= 0 {
            return Err("Dimensão inválida do ícone.".into());
        }

        let screen_dc = unsafe { GetDC(0) };

        if screen_dc == 0 {
            return Err("Não foi possível obter DC.".into());
        }

        let mut cleanup_dc = true;

        let mut info = BitmapInfo {
            bmi_header: BitmapInfoHeader {
                bi_size: size_of::<BitmapInfoHeader>() as u32,
                bi_width: width,
                bi_height: -height,
                bi_planes: 1,
                bi_bit_count: 32,
                bi_compression: BI_RGB,
                bi_size_image: 0,
                bi_x_pels_per_meter: 0,
                bi_y_pels_per_meter: 0,
                bi_clr_used: 0,
                bi_clr_important: 0,
            },
            bmi_colors: [0],
        };

        let mut bgra = vec![0u8; (width * height * 4) as usize];

        let lines = unsafe {
            GetDIBits(
                screen_dc,
                icon_info.hbm_color,
                0,
                height as u32,
                bgra.as_mut_ptr() as *mut c_void,
                &mut info,
                DIB_RGB_COLORS,
            )
        };

        if cleanup_dc {
            unsafe {
                ReleaseDC(0, screen_dc);
            }

            cleanup_dc = false;
        }

        if lines == 0 {
            return Err("GetDIBits falhou para o ícone.".into());
        }

        for pixel in bgra.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }

        let image = RgbaImage::from_raw(width as u32, height as u32, bgra)
            .ok_or("Não foi possível criar imagem do ícone.")?;

        let mut png = Vec::new();

        DynamicImage::ImageRgba8(image)
            .write_to(&mut std::io::Cursor::new(&mut png), ImageFormat::Png)?;

        let encoded = STANDARD.encode(png);

        Ok(format!("data:image/png;base64,{encoded}"))
    })();

    unsafe {
        if icon_info.hbm_color != 0 {
            DeleteObject(icon_info.hbm_color);
        }

        if icon_info.hbm_mask != 0 {
            DeleteObject(icon_info.hbm_mask);
        }
    }

    result
}

pub fn capture_window_snapshot(
    source_id: u64,
) -> Result<WindowPreviewFrame, Box<dyn Error + Send + Sync>> {
    let hwnd = source_id as usize as Hwnd;

    let mut window_rect = Rect {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };

    let success = unsafe { GetWindowRect(hwnd, &mut window_rect) };

    if success == 0 {
        return Err("Não foi possível obter o tamanho da janela.".into());
    }

    let width = window_rect.right - window_rect.left;
    let height = window_rect.bottom - window_rect.top;

    if width <= 0 || height <= 0 {
        return Err("A janela possui tamanho inválido.".into());
    }

    let screen_dc = unsafe { GetDC(0) };

    if screen_dc == 0 {
        return Err("Não foi possível obter o device context.".into());
    }

    let cleanup_screen_dc = || unsafe {
        ReleaseDC(0, screen_dc);
    };

    let memory_dc = unsafe { CreateCompatibleDC(screen_dc) };

    if memory_dc == 0 {
        cleanup_screen_dc();

        return Err("Não foi possível criar DC compatível.".into());
    }

    let cleanup_memory_dc = || unsafe {
        DeleteDC(memory_dc);
    };

    let bitmap = unsafe { CreateCompatibleBitmap(screen_dc, width, height) };

    if bitmap == 0 {
        cleanup_memory_dc();
        cleanup_screen_dc();

        return Err("Não foi possível criar bitmap.".into());
    }

    let old_object = unsafe { SelectObject(memory_dc, bitmap) };

    let printed = unsafe { PrintWindow(hwnd, memory_dc, PW_RENDERFULLCONTENT) };

    if printed == 0 {
        unsafe {
            SelectObject(memory_dc, old_object);

            DeleteObject(bitmap);
        }

        cleanup_memory_dc();
        cleanup_screen_dc();

        return Err("PrintWindow falhou.".into());
    }

    let mut info = BitmapInfo {
        bmi_header: BitmapInfoHeader {
            bi_size: size_of::<BitmapInfoHeader>() as u32,
            bi_width: width,
            // Negativo = bitmap top-down.
            bi_height: -height,
            bi_planes: 1,
            bi_bit_count: 32,
            bi_compression: BI_RGB,
            bi_size_image: 0,
            bi_x_pels_per_meter: 0,
            bi_y_pels_per_meter: 0,
            bi_clr_used: 0,
            bi_clr_important: 0,
        },
        bmi_colors: [0],
    };

    let mut bgra = vec![0u8; (width * height * 4) as usize];

    let lines = unsafe {
        GetDIBits(
            screen_dc,
            bitmap,
            0,
            height as u32,
            bgra.as_mut_ptr() as *mut c_void,
            &mut info,
            DIB_RGB_COLORS,
        )
    };

    unsafe {
        SelectObject(memory_dc, old_object);

        DeleteObject(bitmap);
    }

    cleanup_memory_dc();
    cleanup_screen_dc();

    if lines == 0 {
        return Err("GetDIBits falhou.".into());
    }

    // GetDIBits nos entrega BGRA.
    // O image crate usa RGBA.
    for pixel in bgra.chunks_exact_mut(4) {
        pixel.swap(0, 2);
        pixel[3] = 255;
    }

    let image = RgbaImage::from_raw(width as u32, height as u32, bgra)
        .ok_or("Não foi possível criar RgbaImage.")?;

    let image = DynamicImage::ImageRgba8(image).to_rgb8();

    let thumbnail = image::imageops::thumbnail(&image, 480, 270);

    let mut jpeg = Vec::new();

    {
        let mut encoder = JpegEncoder::new_with_quality(&mut jpeg, 80);

        encoder.encode_image(&DynamicImage::ImageRgb8(thumbnail))?;
    }

    Ok(WindowPreviewFrame {
        source_id,
        source_type: super::PreviewSourceType::Window,
        mime_type: "image/jpeg".to_string(),
        data: jpeg,
    })
}

impl LatestFrame {
    fn new() -> Self {
        Self {
            data: Mutex::new(None),
            condvar: Condvar::new(),
        }
    }

    fn push(&self, frame: CapturedFrame) {
        let mut data = self.data.lock().unwrap();

        // Mantém somente o frame mais recente.
        *data = Some(frame);

        self.condvar.notify_one();
    }

    fn take(&self, stop: &AtomicBool) -> Option<CapturedFrame> {
        let mut data = self.data.lock().unwrap();

        while data.is_none() && !stop.load(Ordering::Relaxed) {
            data = self.condvar.wait(data).unwrap();
        }

        if stop.load(Ordering::Relaxed) {
            return None;
        }

        data.take()
    }

    fn wake(&self) {
        self.condvar.notify_all();
    }
}
