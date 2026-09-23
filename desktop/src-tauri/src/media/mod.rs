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
pub mod session;
pub mod sources;
pub mod video_capture;

pub use capture::{spawn_capture, CaptureContext, CaptureHandle, EndReason, OnEnd, ReadySignal};
pub use gate::FrameGate;
pub use sink::{
    AudioSink, CapturedFrame, SinkStatus, VideoSink, AUDIO_CHANNELS, AUDIO_SAMPLE_RATE,
};
