//! Implementação da plataforma Windows (Win32, WASAPI, WGC, D3D11 e Media Foundation).
//!
//! Chamado de "win32" e não "windows" para não colidir de nome com a crate
//! `windows`, que é dependência direta do projeto: o erro do compilador nesse
//! tipo de conflito é confuso.

pub mod audio_capture;
pub mod focus;
pub mod gpu;
pub mod hr;
pub mod sources;
pub mod wgc;
pub mod window_capture;

pub use audio_capture::spawn_audio_capture;
pub use focus::{bring_to_front, exclude_from_capture};
pub use sources::list::{list_monitors, list_windows};
pub use sources::{monitor_details, window_details};
pub use window_capture::{prepare_window_capture_thread, window_state};
