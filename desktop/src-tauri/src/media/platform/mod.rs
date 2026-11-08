//! Escolhe a implementação de plataforma em tempo de compilação.
//!
//! Regra: quem está fora de `platform/` nunca usa nada de `platform/win32/`
//! (ou de qualquer outro backend de plataforma) diretamente. Os pontos de
//! entrada comuns (`media/sources.rs`, `media/audio.rs`, `media/video.rs`,
//! `media/thumbnails.rs` e `media/focus.rs`) definem os tipos e as funções públicas, e só
//! eles chamam `platform::...`.

#[cfg(target_os = "windows")]
mod win32;
#[cfg(target_os = "windows")]
pub use win32::*;

#[cfg(not(target_os = "windows"))]
mod unsupported;
#[cfg(not(target_os = "windows"))]
pub use unsupported::*;
