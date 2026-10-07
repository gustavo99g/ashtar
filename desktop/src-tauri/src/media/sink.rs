//! `CapturedFrame` e os traits que a captura usa para entregar dados, sem
//! saber se o destino é o IPC ou um publicador nativo (decisão 12 do
//! `docs/plans/v0.1-reorganizacao.md`). `push` recebe `&CapturedFrame`/`&[f32]` (referência, não
//! posse), para permitir reenviar o último frame e, no futuro, um `TeeSink`
//! que alimenta publicador e preview ao mesmo tempo sem copiar.

use livekit::webrtc::video_frame::I420Buffer;

use super::gate::FrameGate;

pub struct CapturedFrame {
    pub buffer: I420Buffer,
    pub timestamp_us: i64, // relativo ao início da captura, via Instant
}

pub enum SinkStatus {
    Continue,
    Stop,
}

pub trait VideoSink: Send + 'static {
    fn push(&mut self, frame: &CapturedFrame) -> SinkStatus;

    /// Portão de backpressure. `None` = sempre aberto.
    fn gate(&self) -> Option<FrameGate> {
        None
    }
}

pub const AUDIO_SAMPLE_RATE: u32 = 48_000;
pub const AUDIO_CHANNELS: usize = 2;

pub trait AudioSink: Send + 'static {
    /// f32 intercalado no formato das constantes acima, já zerado se o
    /// pacote veio silencioso.
    fn push(&mut self, samples: &[f32]) -> SinkStatus;
}
