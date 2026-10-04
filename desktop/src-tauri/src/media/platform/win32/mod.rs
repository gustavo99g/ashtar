//! Implementação da plataforma Windows (Win32/WASAPI/DesktopCapturer).
//!
//! Chamado de "win32" e não "windows" para não colidir de nome com a crate
//! `windows`, caso ela vire dependência direta do projeto — o erro do
//! compilador nesse tipo de conflito é confuso.

pub mod audio_capture;
pub mod sources;
pub mod window_capture;

pub use audio_capture::spawn_audio_capture;
pub use sources::{monitor_details, window_details};
pub use window_capture::{prepare_window_capture_thread, window_state};
