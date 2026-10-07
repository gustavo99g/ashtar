//! Caminho IPC (temporário, ver ADR 0007): sinks que entregam a captura ao
//! webview pelo `Channel` do Tauri, como bytes crus.
//!
//! Quem usa: a sessão (`session.rs`), que cria os sinks com os canais
//! recebidos no comando de início (Etapa 4). A captura não sabe que eles
//! existem: só enxerga um [`VideoSink`] ou um [`AudioSink`].
//!
//! Formato das mensagens (números sempre em little-endian):
//!
//! - vídeo: cabeçalho de [`VIDEO_HEADER_LEN`] bytes (`width: u32`, `height: u32`,
//!   `timestamp_us: i64`, relativo ao início da captura), seguido dos planos Y, U e V
//!   colados, sem o padding do stride;
//! - áudio: só as amostras f32 intercaladas (estéreo, 48 kHz).
//!
//! Regras que este módulo garante:
//!
//! - no vídeo, cada frame enviado ocupa uma vaga do [`FrameGate`] até o ACK do
//!   frontend; com o portão fechado, o frame é descartado;
//! - um envio que falha (webview fechado) devolve [`SinkStatus::Stop`], e a
//!   captura encerra.

use livekit::webrtc::video_frame::VideoBuffer;
use tauri::ipc::{Channel, InvokeResponseBody};
use tracing::warn;

use crate::media::{AudioSink, FrameGate, SinkStatus, VideoSink};

use super::CapturedFrame;

/// Tamanho do cabeçalho de cada frame de vídeo, em bytes.
pub const VIDEO_HEADER_LEN: usize = 16;

// ============================================================================
// Vídeo
// ============================================================================

/// Envia frames I420 ao webview, respeitando o limite de frames em trânsito.
pub struct IpcVideoSink {
    channel: Channel<InvokeResponseBody>,
    gate: FrameGate,
}

impl IpcVideoSink {
    /// `gate` é um clone do portão que a sessão guarda para liberar nos ACKs.
    pub fn new(channel: Channel<InvokeResponseBody>, gate: FrameGate) -> Self {
        Self { channel, gate }
    }
}

impl VideoSink for IpcVideoSink {
    fn push(&mut self, frame: &CapturedFrame) -> SinkStatus {
        // A captura já consulta o portão antes de capturar, para não gastar
        // trabalho à toa. Esta checagem é a garantia final: quem responde pelo
        // limite de frames em trânsito é o sink.
        if !self.gate.is_open() {
            return SinkStatus::Continue;
        }

        let payload = pack_video_frame(frame);

        // Entra no portão ANTES de enviar. Se entrasse depois, o ACK poderia chegar (o frontend
        // responde em outra thread) antes do `enter`: o `release` cairia num contador em zero, seria
        // ignorado, e a vaga ficaria presa para sempre.
        self.gate.enter();

        if let Err(error) = self.channel.send(InvokeResponseBody::Raw(payload)) {
            // O frame não saiu, então não haverá ACK: devolve a vaga.
            self.gate.release();
            warn!(%error, "falha ao enviar frame pelo IPC, encerrando a captura");
            return SinkStatus::Stop;
        }
        SinkStatus::Continue
    }

    /// O portão é compartilhado: a captura o consulta para nem capturar com ele fechado.
    fn gate(&self) -> Option<FrameGate> {
        Some(self.gate.clone())
    }
}

/// Monta a mensagem de um frame: cabeçalho e planos Y, U e V sem padding.
fn pack_video_frame(frame: &CapturedFrame) -> Vec<u8> {
    let buffer = &frame.buffer;
    let width = buffer.width() as usize;
    let height = buffer.height() as usize;
    let chroma_width = buffer.chroma_width() as usize;
    let chroma_height = buffer.chroma_height() as usize;
    let (y, u, v) = buffer.data();
    let (stride_y, stride_u, stride_v) = buffer.strides();
    let expected_len = VIDEO_HEADER_LEN + width * height + 2 * chroma_width * chroma_height;

    let mut payload = Vec::with_capacity(expected_len);

    payload.extend_from_slice(&buffer.width().to_le_bytes());
    payload.extend_from_slice(&buffer.height().to_le_bytes());
    payload.extend_from_slice(&frame.timestamp_us.to_le_bytes());

    copy_plane(&mut payload, y, stride_y as usize, width, height);
    copy_plane(
        &mut payload,
        u,
        stride_u as usize,
        chroma_width,
        chroma_height,
    );
    copy_plane(
        &mut payload,
        v,
        stride_v as usize,
        chroma_width,
        chroma_height,
    );

    payload
}

/// Copia `rows` linhas de `width` bytes de um plano, descartando o padding do fim de cada
/// linha (`stride - width` bytes).
fn copy_plane(out: &mut Vec<u8>, plane: &[u8], stride: usize, width: usize, rows: usize) {
    for line in plane.chunks(stride).take(rows) {
        out.extend_from_slice(&line[..width]);
    }
}

// ============================================================================
// Áudio
// ============================================================================

/// Envia as amostras de áudio ao webview como f32 crus.
///
/// Não tem portão: descartar áudio não economiza trabalho nenhum, só perderia amostras. Quem
/// absorve atrasos é o jitter buffer do worklet (Etapa 5.4).
pub struct IpcAudioSink {
    channel: Channel<InvokeResponseBody>,
}

impl IpcAudioSink {
    pub fn new(channel: Channel<InvokeResponseBody>) -> Self {
        Self { channel }
    }
}

impl AudioSink for IpcAudioSink {
    fn push(&mut self, samples: &[f32]) -> SinkStatus {
        if samples.is_empty() {
            return SinkStatus::Continue;
        }
        let payload = samples_to_bytes(samples);

        if let Err(error) = self.channel.send(InvokeResponseBody::Raw(payload)) {
            warn!(%error, "falha ao enviar áudio pelo IPC, encerrando a captura");
            return SinkStatus::Stop;
        }

        SinkStatus::Continue
    }
}

fn samples_to_bytes(samples: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(std::mem::size_of_val(samples));
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }

    bytes
}

#[cfg(test)]
mod tests {
    use super::*;
    use livekit::webrtc::video_frame::I420Buffer;
    use std::sync::{Arc, Mutex};

    /// Frame 4×2 com stride maior que a largura: o padding é preenchido com
    /// 0xEE, um valor que nunca aparece nos pixels de verdade.
    fn frame_with_padding() -> CapturedFrame {
        // Y: 4 de largura, stride 8. U e V: 2 de largura, stride 4.
        let mut buffer = I420Buffer::with_strides(4, 2, 8, 4, 4);
        let (y, u, v) = buffer.data_mut();

        y.fill(0xEE);
        u.fill(0xEE);
        v.fill(0xEE);

        y[0..4].copy_from_slice(&[1, 2, 3, 4]);
        y[8..12].copy_from_slice(&[5, 6, 7, 8]);
        u[0..2].copy_from_slice(&[10, 11]);
        v[0..2].copy_from_slice(&[20, 21]);

        CapturedFrame {
            buffer,
            timestamp_us: 1_234_567,
        }
    }
    type Received = Arc<Mutex<Vec<Vec<u8>>>>;

    /// Canal de teste que guarda cada mensagem recebida, sem precisar de webview.
    fn recording_channel() -> (Channel<InvokeResponseBody>, Received) {
        let received: Received = Arc::new(Mutex::new(Vec::new()));
        let store = Arc::clone(&received);

        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Raw(bytes) = body {
                store.lock().unwrap().push(bytes);
            }
            Ok(())
        });

        (channel, received)
    }

    /// Canal de teste que falha em todo envio, como um webview que fechou.
    fn broken_channel() -> Channel<InvokeResponseBody> {
        Channel::new(|_| Err(tauri::Error::WebviewNotFound))
    }

    #[test]
    fn frame_enviado_ocupa_uma_vaga_do_portao() {
        let (channel, received) = recording_channel();
        let gate = FrameGate::new(2);
        let mut sink = IpcVideoSink::new(channel, gate.clone());
        let frame = frame_with_padding();

        sink.push(&frame);
        sink.push(&frame);
        assert!(
            !gate.is_open(),
            "dois frames em trânsito deveriam fechar o portão"
        );

        // Portão fechado: o frame é descartado, mas a captura continua.
        assert!(matches!(sink.push(&frame), SinkStatus::Continue));
        assert_eq!(received.lock().unwrap().len(), 2);

        // Chegou um ACK: a vaga volta e o próximo frame sai.
        gate.release();
        sink.push(&frame);
        assert_eq!(received.lock().unwrap().len(), 3);
    }

    #[test]
    fn falha_no_envio_de_video_para_e_devolve_a_vaga() {
        let gate = FrameGate::new(1);
        let mut sink = IpcVideoSink::new(broken_channel(), gate.clone());

        assert!(matches!(sink.push(&frame_with_padding()), SinkStatus::Stop));
        assert!(
            gate.is_open(),
            "a vaga do frame que não saiu deveria voltar"
        );
    }

    #[test]
    fn empacota_sem_reservar_memoria_a_mais() {
        let payload = pack_video_frame(&frame_with_padding());

        // 16 de cabeçalho + 8 do Y (4×2) + 2 do U (2×1) + 2 do V (2×1).
        assert_eq!(payload.len(), VIDEO_HEADER_LEN + 8 + 2 + 2);
        // A capacidade pedida tem que ser exatamente o tamanho da mensagem. Uma conta errada
        // aqui não quebra nenhum outro teste, mas reservaria dezenas de MB por frame.
        assert_eq!(payload.capacity(), payload.len());
    }

    #[test]
    fn empacota_sem_o_padding_do_stride() {
        let payload = pack_video_frame(&frame_with_padding());

        let (header, planes) = payload.split_at(VIDEO_HEADER_LEN);
        assert_eq!(&header[0..4], &4u32.to_le_bytes());
        assert_eq!(&header[4..8], &2u32.to_le_bytes());
        assert_eq!(&header[8..16], &1_234_567i64.to_le_bytes());

        assert_eq!(planes, &[1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 20, 21]);
    }

    #[test]
    fn amostras_viram_f32_little_endian() {
        let samples = [0.0_f32, 1.0, -0.5, 0.25];
        let bytes = samples_to_bytes(&samples);

        assert_eq!(bytes.len(), samples.len() * 4);

        let back: Vec<f32> = bytes
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| f32::from_le_bytes(*b))
            .collect();
        assert_eq!(back, samples);
    }

    #[test]
    fn sink_de_audio_envia_uma_mensagem_por_pacote() {
        let (channel, received) = recording_channel();
        let mut sink = IpcAudioSink::new(channel);

        assert!(matches!(sink.push(&[0.5; 960]), SinkStatus::Continue));
        assert!(matches!(sink.push(&[]), SinkStatus::Continue));

        let received = received.lock().unwrap();
        assert_eq!(received.len(), 1, "pacote vazio não deveria virar mensagem");
        assert_eq!(received[0].len(), 960 * 4);
    }

    #[test]
    fn falha_no_envio_de_audio_para_a_captura() {
        let mut sink = IpcAudioSink::new(broken_channel());
        assert!(matches!(sink.push(&[0.0; 960]), SinkStatus::Stop));
    }

    #[test]
    #[ignore = "precisa de áudio tocando no computador"]
    fn captura_o_sistema_pelo_ipc() {
        use crate::media::audio::{spawn_audio_capture, AudioMode};
        use crate::media::{AUDIO_CHANNELS, AUDIO_SAMPLE_RATE};
        use std::time::{Duration, Instant};

        let (channel, received) = recording_channel();
        let handle = spawn_audio_capture(
            AudioMode::System,
            IpcAudioSink::new(channel),
            Box::new(|_| {}),
        )
        .expect("a captura deveria iniciar")
        .expect("o modo System deveria criar uma captura");

        let started = Instant::now();
        std::thread::sleep(Duration::from_secs(3));
        handle.stop_and_join();
        let elapsed = started.elapsed().as_secs_f64();

        let received = received.lock().unwrap();
        assert!(
            received.iter().all(|m| m.len() % (4 * AUDIO_CHANNELS) == 0),
            "toda mensagem deveria ter frames estéreo inteiros"
        );

        let bytes: usize = received.iter().map(Vec::len).sum();
        let rate = (bytes / (4 * AUDIO_CHANNELS)) as f64 / elapsed;
        let expected = f64::from(AUDIO_SAMPLE_RATE);
        assert!(
            (rate - expected).abs() < expected * 0.1,
            "taxa inesperada: {rate:.0} frames/s"
        );
    }
}
