#[cfg(target_os = "windows")]
pub mod windows;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct WindowSource {
    pub id: u64,
    pub title: String,
    pub process_id: u32,
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MonitorSource {
    pub id: u64,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PreviewSourceType {
    Window,
    Monitor,
}

#[derive(Debug, Clone, Serialize)]
pub struct WindowPreviewFrame {
    pub source_id: u64,
    pub source_type: PreviewSourceType,
    pub mime_type: String,
    pub data: Vec<u8>,
}

mod webrtc;

pub use webrtc::*;
