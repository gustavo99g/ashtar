//! O que as capturas usam para entregar dados sem saber o destino. O vídeo tem o dele, o
//! `PacketSink` (`encoded.rs`); aqui fica o do áudio e o `SinkStatus` dos dois.

pub enum SinkStatus {
    Continue,
    Stop,
}

pub const AUDIO_SAMPLE_RATE: u32 = 48_000;
pub const AUDIO_CHANNELS: usize = 2;

pub trait AudioSink: Send + 'static {
    /// f32 intercalado no formato das constantes acima, já zerado se o
    /// pacote veio silencioso.
    fn push(&mut self, samples: &[f32]) -> SinkStatus;
}
