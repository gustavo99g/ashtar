//! A transmissão de tela: a captura (vídeo pelo WGC, áudio pelo WASAPI), o vídeo na GPU e a
//! publicação na LiveKit pela conexão `:screen` (ADRs 0017 e 0018).
//!
//! `capture.rs` e `sink.rs` são a base de qualquer captura, em qualquer plataforma;
//! `sources.rs`, `audio.rs`, `video.rs`, `thumbnails.rs` e `focus.rs` são os pontos de entrada comuns, e
//! `platform/` escolhe a implementação real (`win32` hoje). Ninguém fora de `platform/` usa
//! `platform::win32` diretamente: só os pontos de entrada comuns chamam `platform::...`.

mod capture;
mod sink;

pub mod audio;
pub mod bitrate;
#[cfg(test)]
mod diagnostics;
pub mod encoded;
pub mod focus;
pub mod leveler;
pub mod platform;
pub mod publisher;
pub mod quality;
pub mod screenshot;
pub mod share;
#[cfg(test)]
mod share_e2e;
pub mod sources;
pub mod thumbnails;
pub mod video;

pub use capture::{spawn_capture, CaptureHandle, EndReason, OnEnd};
pub use sink::{AudioSink, SinkStatus, AUDIO_CHANNELS, AUDIO_SAMPLE_RATE};
