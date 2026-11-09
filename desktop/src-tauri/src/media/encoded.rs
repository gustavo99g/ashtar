//! O que sai do vídeo da transmissão, e para onde vai (ADR 0018).
//!
//! O pipeline (`video.rs`) entrega cada pacote a um [`PacketSink`]: o publicador da Etapa 3 e, para
//! conferir a imagem, o [`H264File`]. Com o [`Fanout`], o mesmo pacote vai a mais de um destino sem
//! copiar, que é a base dos clipes e do replay (v1.1).
//!
//! Com o encoder de hardware, o pacote é um [`EncodedFrame`] (H.264 pronto). No plano B, sem
//! encoder de hardware, é um [`RawFrame`] (a imagem já reduzida, em NV12), que o publicador
//! codifica em software.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

use super::SinkStatus;

/// Um access unit H.264 completo, em Annex B (os NAL começam com `00 00 00 01`). Um keyframe
/// traz o SPS e o PPS na frente.
#[derive(Debug, Clone)]
pub struct EncodedFrame {
    pub data: Vec<u8>,
    pub keyframe: bool,
    /// Quando a imagem foi composta pelo Windows, em microssegundos desde 1970 (o relógio que o
    /// libwebrtc usa para os frames).
    pub timestamp_us: i64,
    pub width: u32,
    pub height: u32,
}

/// Uma imagem em NV12, sem sobra no fim das linhas: o plano Y (`width × height` bytes) e, logo
/// depois, o UV intercalado (`width × height / 2`).
#[derive(Debug, Clone)]
pub struct RawFrame {
    pub nv12: Vec<u8>,
    pub timestamp_us: i64,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone)]
pub enum VideoPacket {
    Encoded(EncodedFrame),
    Raw(RawFrame),
}

/// Um destino do vídeo. `push` recebe uma referência: o [`Fanout`] entrega o mesmo pacote a
/// todos sem copiar. Devolver `Stop` encerra a transmissão.
pub trait PacketSink: Send + 'static {
    fn push(&mut self, packet: &VideoPacket) -> SinkStatus;
}

/// Entrega cada pacote a todos os destinos, na ordem. Se um deles pedir `Stop`, a transmissão
/// acaba (os outros ainda recebem aquele pacote).
#[derive(Default)]
pub struct Fanout {
    sinks: Vec<Box<dyn PacketSink>>,
}

impl Fanout {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with(mut self, sink: impl PacketSink) -> Self {
        self.sinks.push(Box::new(sink));
        self
    }
}

impl PacketSink for Fanout {
    fn push(&mut self, packet: &VideoPacket) -> SinkStatus {
        let mut status = SinkStatus::Continue;
        for sink in &mut self.sinks {
            if let SinkStatus::Stop = sink.push(packet) {
                status = SinkStatus::Stop;
            }
        }
        status
    }
}

/// Grava o H.264 num arquivo `.h264`, para conferir a imagem no VLC ou no `ffplay`. Os pacotes do
/// plano B não são gravados. Um erro de escrita só desliga a gravação: a transmissão continua.
pub struct H264File {
    out: Option<BufWriter<File>>,
    frames: u64,
}

impl H264File {
    pub fn create(path: &Path) -> std::io::Result<Self> {
        Ok(Self {
            out: Some(BufWriter::new(File::create(path)?)),
            frames: 0,
        })
    }

    #[cfg(test)]
    pub fn frames(&self) -> u64 {
        self.frames
    }
}

impl PacketSink for H264File {
    fn push(&mut self, packet: &VideoPacket) -> SinkStatus {
        let (VideoPacket::Encoded(frame), Some(out)) = (packet, self.out.as_mut()) else {
            return SinkStatus::Continue;
        };
        if let Err(error) = out.write_all(&frame.data) {
            tracing::warn!(%error, "a gravação do .h264 parou");
            self.out = None;
        } else {
            self.frames += 1;
        }
        SinkStatus::Continue
    }
}

impl Drop for H264File {
    fn drop(&mut self) {
        if let Some(out) = self.out.as_mut() {
            let _ = out.flush();
        }
        tracing::info!(target: "media", frames = self.frames, "o .h264 de diagnóstico foi fechado");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// Um destino que anota o tamanho de cada pacote e responde `status`.
    struct Probe {
        seen: Arc<Mutex<Vec<usize>>>,
        status: fn() -> SinkStatus,
    }

    impl PacketSink for Probe {
        fn push(&mut self, packet: &VideoPacket) -> SinkStatus {
            let len = match packet {
                VideoPacket::Encoded(frame) => frame.data.len(),
                VideoPacket::Raw(frame) => frame.nv12.len(),
            };
            self.seen.lock().unwrap().push(len);
            (self.status)()
        }
    }

    fn encoded(len: usize) -> VideoPacket {
        VideoPacket::Encoded(EncodedFrame {
            data: vec![0; len],
            keyframe: false,
            timestamp_us: 0,
            width: 16,
            height: 16,
        })
    }

    #[test]
    fn todos_os_destinos_recebem_o_mesmo_pacote() {
        let (a, b) = (Arc::default(), Arc::default());
        let mut fanout = Fanout::new()
            .with(Probe {
                seen: Arc::clone(&a),
                status: || SinkStatus::Continue,
            })
            .with(Probe {
                seen: Arc::clone(&b),
                status: || SinkStatus::Continue,
            });
        assert!(matches!(fanout.push(&encoded(3)), SinkStatus::Continue));
        assert!(matches!(fanout.push(&encoded(5)), SinkStatus::Continue));
        assert_eq!(*a.lock().unwrap(), [3, 5]);
        assert_eq!(*b.lock().unwrap(), [3, 5]);
    }

    #[test]
    fn um_destino_que_para_encerra_mas_os_outros_ainda_recebem() {
        let seen = Arc::default();
        let mut fanout = Fanout::new()
            .with(Probe {
                seen: Arc::default(),
                status: || SinkStatus::Stop,
            })
            .with(Probe {
                seen: Arc::clone(&seen),
                status: || SinkStatus::Continue,
            });
        assert!(matches!(fanout.push(&encoded(1)), SinkStatus::Stop));
        assert_eq!(*seen.lock().unwrap(), [1]);
    }

    #[test]
    fn o_arquivo_guarda_so_o_h264() {
        let path = std::env::temp_dir().join(format!("ashtar-teste-{}.h264", std::process::id()));
        {
            let mut file = H264File::create(&path).unwrap();
            file.push(&VideoPacket::Encoded(EncodedFrame {
                data: vec![0, 0, 0, 1, 0x65],
                keyframe: true,
                timestamp_us: 0,
                width: 16,
                height: 16,
            }));
            file.push(&VideoPacket::Raw(RawFrame {
                nv12: vec![9; 384],
                timestamp_us: 0,
                width: 16,
                height: 16,
            }));
            assert_eq!(file.frames(), 1);
        }
        assert_eq!(std::fs::read(&path).unwrap(), [0, 0, 0, 1, 0x65]);
        let _ = std::fs::remove_file(path);
    }
}
