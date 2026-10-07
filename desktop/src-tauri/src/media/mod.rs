//! Módulos de captura de mídia (vídeo/áudio), independentes do destino (IPC
//! hoje, publicador LiveKit nativo depois — decisão 12 do `docs/plans/v0.1-reorganizacao.md`).
//! `sink.rs`, `gate.rs` e `capture.rs` são a base compartilhada por qualquer
//! captura, em qualquer plataforma; `sources.rs`/`audio.rs` são os pontos de
//! entrada comuns, e `platform/` escolhe a implementação real (`win32` hoje).
//! Ninguém fora de `platform/` deve usar `platform::win32` diretamente — só
//! os pontos de entrada comuns chamam `platform::...`.

// `dead_code` cobre os tipos/funções ainda sem uso; `unused_imports` cobre
// os `pub use` deste arquivo, que o rustc flagra por ninguém (dentro do
// crate) ainda importar `crate::media::...`. Remover os dois na Etapa 4,
// quando os comandos novos usarem tudo.
#![allow(dead_code, unused_imports)]

mod capture;
mod gate;
mod sink;

pub mod audio;
pub mod diagnostics;
pub mod ipc_sink;
pub mod platform;
pub mod quality;
pub mod session;
pub mod sources;
pub mod video_capture;

pub use capture::{spawn_capture, CaptureContext, CaptureHandle, EndReason, OnEnd, ReadySignal};
pub use gate::FrameGate;
pub use sink::{
    AudioSink, CapturedFrame, SinkStatus, VideoSink, AUDIO_CHANNELS, AUDIO_SAMPLE_RATE,
};
