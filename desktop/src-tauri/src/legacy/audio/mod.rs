#[cfg(target_os = "windows")]
pub mod windows;

pub enum ScreenShareAudioMode {
    System(u32),
    Application(u32),
}
