//! Implementação da plataforma Windows (Win32, WASAPI, WGC, D3D11 e Media Foundation).
//!
//! Chamado de "win32" e não "windows" para não colidir de nome com a crate
//! `windows`, que é dependência direta do projeto: o erro do compilador nesse
//! tipo de conflito é confuso.

pub mod amf;
pub mod audio_capture;
pub mod clipboard;
pub mod convert;
pub mod focus;
pub mod gpu;
pub mod hardware;
pub mod hr;
pub mod mf_encoder;
pub mod pipeline;
pub mod readback;
pub mod sources;
pub mod still;
pub mod thumbnails;
pub mod wgc;

pub use audio_capture::spawn_audio_capture;
pub use clipboard::copy_image;
pub use focus::{bring_to_front, exclude_from_capture};
pub use pipeline::spawn_video;
pub use sources::exe_icon_png;
pub use sources::list::{list_monitors, list_windows, shareable_window_pids};
pub use still::capture_still;
pub use thumbnails::spawn_thumbnails;

/// O nome da placa de vídeo que a captura usaria, para o `info.txt` do "Enviar logs".
pub fn gpu_name() -> Option<String> {
    gpu::GpuDevice::new()
        .ok()
        .map(|gpu| gpu.adapter_name().to_owned())
}
