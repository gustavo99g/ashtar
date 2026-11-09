//! A conexão `{user_id}:screen` na LiveKit, que publica a tela e o áudio dela (ADR 0017).
//!
//! O app tem duas conexões na sala: a da voz, no WebView, e esta, no Rust. A LiveKit não aceita
//! duas conexões com a mesma identidade, daí o `:screen`; o token (da rota `voice/screen-token`)
//! só publica a tela e o áudio dela, e não assina nada.
//!
//! - **Vídeo:** com o encoder de hardware, a trilha é H.264 já codificado
//!   (`NativeVideoSource::new_encoded`, `VideoEncoderBackend::PreEncoded`), sem simulcast. Os
//!   pedidos de keyframe e de bitrate da LiveKit voltam para o pipeline pelo [`VideoControl`]. No
//!   plano B, a trilha é a comum (NV12, VP8 codificado pelo libwebrtc).
//! - **Áudio:** o WASAPI entrega f32; aqui passa pelo [`Leveler`] (se a chave estiver ligada) e vira
//!   i16 em pedaços de 10 ms para o `NativeAudioSource`.
//! - **Pausa:** a trilha de vídeo é silenciada (`mute`); quem assiste vê "Transmissão pausada".
//!
//! Tudo que é assíncrono roda no runtime do Tauri. As funções daqui bloqueiam: chamar só dentro
//! de `spawn_blocking` (ou de uma thread de captura).

use std::borrow::Cow;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::thread::JoinHandle;
use std::time::Duration;

use livekit::options::{TrackPublishOptions, VideoCodec, VideoEncoderBackend, VideoEncoding};
use livekit::prelude::*;
use livekit::webrtc::audio_frame::AudioFrame;
use livekit::webrtc::audio_source::native::NativeAudioSource;
use livekit::webrtc::audio_source::{AudioSourceOptions, RtcAudioSource};
use livekit::webrtc::video_frame::{
    EncodedFrameType, EncodedVideoCodec, EncodedVideoFrame, NV12Buffer, VideoFrame, VideoRotation,
};
use livekit::webrtc::video_source::native::NativeVideoSource;
use livekit::webrtc::video_source::{RtcVideoSource, VideoResolution};
use serde::Deserialize;
use tauri::async_runtime;
use tracing::{info, warn};

use super::encoded::{PacketSink, VideoPacket};
use super::leveler::Leveler;
use super::video::{EncoderKind, VideoCommand, VideoControl, VideoFormat, MAX_FPS};
use super::{AudioSink, SinkStatus, AUDIO_CHANNELS, AUDIO_SAMPLE_RATE};
use crate::error::AppError;

/// Onde e como entrar: a URL do servidor e o token da `:screen` (o frontend pede à API), e o nome
/// da trilha (`shareTrackName` do frontend, que todo mundo na sala lê).
#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareTarget {
    pub url: String,
    pub token: String,
    pub track_name: String,
}

impl std::fmt::Debug for ShareTarget {
    /// Sem o token: ele vai para o log junto com o resto.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ShareTarget")
            .field("url", &self.url)
            .field("track_name", &self.track_name)
            .finish_non_exhaustive()
    }
}

/// O maior bitrate que a trilha anuncia: o do preset mais caro. A LiveKit nunca pede mais que
/// isso; o pipeline ainda limita ao do preset atual.
pub const MAX_BITRATE_BPS: u32 = 10_000_000;
/// De quanto em quanto tempo os pedidos da LiveKit (keyframe, bitrate) são lidos.
const REQUESTS_EVERY: Duration = Duration::from_millis(20);
/// 10 ms de áudio, por canal.
const AUDIO_CHUNK: usize = AUDIO_SAMPLE_RATE as usize / 100;

fn publish_error(what: &str) -> impl FnOnce(RoomError) -> AppError + '_ {
    move |error| AppError::Publish(format!("{what}: {error}"))
}

/// Onde o destino do vídeo encontra a fonte da trilha. Fica vazio entre o começo do pipeline e a
/// publicação: o tipo da fonte depende do encoder que o pipeline conseguiu abrir.
#[derive(Clone, Default)]
struct VideoSlot(Arc<OnceLock<NativeVideoSource>>);

/// O destino do vídeo na LiveKit. Antes da publicação, descarta.
pub struct LiveKitVideoSink {
    slot: VideoSlot,
}

impl PacketSink for LiveKitVideoSink {
    fn push(&mut self, packet: &VideoPacket) -> SinkStatus {
        let Some(source) = self.slot.0.get() else {
            return SinkStatus::Continue;
        };
        match packet {
            VideoPacket::Encoded(frame) => {
                source.capture_encoded_frame(&EncodedVideoFrame {
                    codec: EncodedVideoCodec::H264,
                    payload: &frame.data,
                    timestamp_us: frame.timestamp_us,
                    frame_type: if frame.keyframe {
                        EncodedFrameType::Key
                    } else {
                        EncodedFrameType::Delta
                    },
                    resolution: VideoResolution {
                        width: frame.width,
                        height: frame.height,
                    },
                    frame_metadata: None,
                });
            }
            VideoPacket::Raw(frame) => {
                let mut buffer = NV12Buffer::new(frame.width, frame.height);
                let (stride_y, stride_uv) = buffer.strides();
                let (y, uv) = buffer.data_mut();
                let (width, height) = (frame.width as usize, frame.height as usize);
                let (src_y, src_uv) = frame.nv12.split_at(width * height);
                copy_plane(src_y, y, width, stride_y as usize);
                copy_plane(src_uv, uv, width, stride_uv as usize);
                source.capture_frame(&VideoFrame {
                    rotation: VideoRotation::VideoRotation0,
                    timestamp_us: frame.timestamp_us,
                    frame_metadata: None,
                    buffer,
                });
            }
        }
        SinkStatus::Continue
    }
}

/// Copia linhas de `width` bytes de `src` (coladas) para `dst` (com `stride` bytes por linha).
fn copy_plane(src: &[u8], dst: &mut [u8], width: usize, stride: usize) {
    for (from, to) in src.chunks_exact(width).zip(dst.chunks_mut(stride)) {
        to[..width].copy_from_slice(from);
    }
}

/// O destino do áudio na LiveKit: f32 intercalado, nivelado, vira i16 em pedaços de 10 ms.
pub struct LiveKitAudioSink {
    source: NativeAudioSource,
    leveler: Leveler,
    /// As amostras da vez, para o nivelador trabalhar sem alocar a cada pedaço.
    scratch: Vec<f32>,
    pending: Vec<i16>,
    failed: bool,
}

impl AudioSink for LiveKitAudioSink {
    fn push(&mut self, samples: &[f32]) -> SinkStatus {
        self.scratch.clear();
        self.scratch.extend_from_slice(samples);
        self.leveler.process(&mut self.scratch);
        self.pending.extend(
            self.scratch
                .iter()
                .map(|s| (s.clamp(-1.0, 1.0) * f32::from(i16::MAX)) as i16),
        );
        let chunk = AUDIO_CHUNK * AUDIO_CHANNELS;
        let mut start = 0;
        while self.pending.len() - start >= chunk {
            let frame = AudioFrame {
                data: Cow::Borrowed(&self.pending[start..start + chunk]),
                sample_rate: AUDIO_SAMPLE_RATE,
                num_channels: AUDIO_CHANNELS as u32,
                samples_per_channel: AUDIO_CHUNK as u32,
            };
            // A thread do WASAPI não é do runtime: aqui pode bloquear. O `capture_frame` espera
            // quando a fila está cheia, o que dá o ritmo.
            if let Err(error) = async_runtime::block_on(self.source.capture_frame(&frame)) {
                if !self.failed {
                    warn!(target: "media", %error, "o áudio da transmissão não entrou na LiveKit");
                    self.failed = true;
                }
            }
            start += chunk;
        }
        self.pending.drain(..start);
        SinkStatus::Continue
    }
}

impl Drop for LiveKitAudioSink {
    fn drop(&mut self) {
        // Para conferir no log se o nivelador estava subindo o som, e quanto.
        info!(
            target: "media",
            gain_db = format_args!("{:.1}", self.leveler.gain_db()),
            "áudio da transmissão encerrado"
        );
    }
}

/// Lê os pedidos da LiveKit para o encoder e repassa ao pipeline, até o `stop`.
struct Requests {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Requests {
    fn start(source: NativeVideoSource, control: VideoControl) -> Result<Self, AppError> {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stop);
        let thread = std::thread::Builder::new()
            .name("ashtar-livekit-requests".into())
            .spawn(move || {
                while !flag.load(Ordering::Acquire) {
                    if source.take_keyframe_request() {
                        control.send(VideoCommand::Keyframe);
                    }
                    if let Some(rate) = source.take_rate_control_request() {
                        let bps = rate.target_bitrate_bps.min(u64::from(u32::MAX)) as u32;
                        control.send(VideoCommand::TargetBitrate(bps));
                    }
                    std::thread::sleep(REQUESTS_EVERY);
                }
            })
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(Self {
            stop,
            thread: Some(thread),
        })
    }
}

impl Drop for Requests {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

pub struct Publisher {
    room: Room,
    track_name: String,
    slot: VideoSlot,
    video: Option<LocalVideoTrack>,
    audio: Option<LocalAudioTrack>,
    /// A chave do nivelador, dividida com o áudio publicado: vale na hora, sem republicar.
    leveler: Arc<AtomicBool>,
    _requests: Option<Requests>,
}

impl Publisher {
    /// Entra na sala como `:screen`. `on_lost` é chamado uma vez se a conexão cair de vez (a
    /// LiveKit já tentou reconectar), e nunca depois do [`Publisher::close`].
    ///
    /// # Bloqueia
    ///
    /// Até entrar na sala (ou falhar).
    pub fn connect(
        target: &ShareTarget,
        on_lost: impl FnOnce(String) + Send + 'static,
    ) -> Result<Self, AppError> {
        let mut options = RoomOptions::default();
        options.auto_subscribe = false;
        let (room, mut events) =
            async_runtime::block_on(Room::connect(&target.url, &target.token, options))
                .map_err(publish_error("não deu para entrar na sala"))?;
        info!(target: "media", sala = %room.name(), "a :screen entrou na sala");

        async_runtime::spawn(async move {
            while let Some(event) = events.recv().await {
                if let RoomEvent::Disconnected { reason } = event {
                    // `ClientInitiated` é o nosso `close`: não é queda.
                    if reason != livekit::DisconnectReason::ClientInitiated {
                        warn!(target: "media", ?reason, "a :screen caiu da sala");
                        on_lost(format!("a conexão da transmissão caiu ({reason:?})"));
                    }
                    return;
                }
            }
        });

        Ok(Self {
            room,
            track_name: target.track_name.clone(),
            slot: VideoSlot::default(),
            video: None,
            audio: None,
            leveler: Arc::new(AtomicBool::new(true)),
            _requests: None,
        })
    }

    /// O destino que o pipeline recebe. Descarta até o [`Publisher::publish_video`].
    pub fn video_sink(&self) -> LiveKitVideoSink {
        LiveKitVideoSink {
            slot: self.slot.clone(),
        }
    }

    /// Publica a trilha de tela, do tipo que o pipeline abriu (`encoder`), no tamanho `size`.
    ///
    /// # Bloqueia
    ///
    /// Até a publicação ser aceita.
    pub fn publish_video(
        &mut self,
        encoder: &EncoderKind,
        size: (u32, u32),
        format: VideoFormat,
        control: VideoControl,
    ) -> Result<(), AppError> {
        let resolution = VideoResolution {
            width: size.0,
            height: size.1,
        };
        let hardware = matches!(encoder, EncoderKind::Hardware(_));
        // A fonte comum lança uma tarefa do Tokio (o quadro preto de reserva): dentro do
        // `block_on` ela tem o runtime do Tauri, de qualquer thread.
        let source = async_runtime::block_on(async {
            if hardware {
                NativeVideoSource::new_encoded(resolution)
            } else {
                NativeVideoSource::new(resolution, true)
            }
        });
        let track = LocalVideoTrack::create_video_track(
            &self.track_name,
            RtcVideoSource::Native(source.clone()),
        );
        let options = TrackPublishOptions {
            source: TrackSource::Screenshare,
            simulcast: false,
            video_codec: if hardware {
                VideoCodec::H264
            } else {
                VideoCodec::VP8
            },
            video_encoder: if hardware {
                VideoEncoderBackend::PreEncoded
            } else {
                VideoEncoderBackend::Auto
            },
            video_encoding: Some(VideoEncoding {
                max_bitrate: u64::from(MAX_BITRATE_BPS.max(format.bitrate_bps)),
                // O teto, e não o fps do preset: trocar de Nitidez (30) para Movimento (60) no meio
                // não republica a trilha, e o encoder de software do plano B não passaria de 30.
                max_framerate: f64::from(MAX_FPS),
            }),
            ..TrackPublishOptions::default()
        };
        async_runtime::block_on(
            self.room
                .local_participant()
                .publish_track(LocalTrack::Video(track.clone()), options),
        )
        .map_err(publish_error("não deu para publicar a tela"))?;

        if hardware {
            self._requests = Some(Requests::start(source.clone(), control.clone())?);
        }
        let _ = self.slot.0.set(source);
        // O primeiro keyframe pode ter saído antes da publicação (e sido descartado).
        control.send(VideoCommand::Keyframe);
        self.video = Some(track);
        info!(target: "media", ?encoder, "a tela foi publicada");
        Ok(())
    }

    /// Publica a trilha do áudio da tela e devolve o destino para a captura.
    ///
    /// # Bloqueia
    ///
    /// Até a publicação ser aceita.
    pub fn publish_audio(&mut self) -> Result<LiveKitAudioSink, AppError> {
        self.unpublish_audio();
        let source = NativeAudioSource::new(
            // Áudio de jogo e vídeo: nada de tratamento de voz.
            AudioSourceOptions {
                echo_cancellation: false,
                noise_suppression: false,
                auto_gain_control: false,
            },
            AUDIO_SAMPLE_RATE,
            AUDIO_CHANNELS as u32,
            100,
        );
        let track = LocalAudioTrack::create_audio_track(
            "screen-share-audio",
            RtcAudioSource::Native(source.clone()),
        );
        let options = TrackPublishOptions {
            source: TrackSource::ScreenshareAudio,
            // Áudio de jogo e vídeo não tem silêncio para economizar, e o RED dobra o envio.
            dtx: false,
            red: false,
            ..TrackPublishOptions::default()
        };
        async_runtime::block_on(
            self.room
                .local_participant()
                .publish_track(LocalTrack::Audio(track.clone()), options),
        )
        .map_err(publish_error("não deu para publicar o áudio"))?;
        self.audio = Some(track);
        Ok(LiveKitAudioSink {
            source,
            leveler: Leveler::new(Arc::clone(&self.leveler)),
            scratch: Vec::new(),
            pending: Vec::new(),
            failed: false,
        })
    }

    /// Liga ou desliga o nivelador do áudio, publicado ou não.
    pub fn set_leveler(&self, enabled: bool) {
        self.leveler.store(enabled, Ordering::Relaxed);
    }

    /// Tira o áudio da sala, se estiver publicado.
    ///
    /// # Bloqueia
    ///
    /// Até a LiveKit confirmar.
    pub fn unpublish_audio(&mut self) {
        let Some(track) = self.audio.take() else {
            return;
        };
        let result =
            async_runtime::block_on(self.room.local_participant().unpublish_track(&track.sid()));
        if let Err(error) = result {
            warn!(target: "media", %error, "não deu para tirar o áudio da sala");
        }
    }

    /// Pausa (silencia a trilha) ou continua.
    ///
    /// # Bloqueia
    ///
    /// O `mute` da crate fala com a sala e precisa do reator do Tokio, que só o runtime do Tauri
    /// tem: por isso passa pelo `block_on`, e funciona de qualquer thread.
    pub fn set_paused(&self, paused: bool) {
        let Some(track) = &self.video else {
            return;
        };
        async_runtime::block_on(async {
            if paused {
                track.mute();
            } else {
                track.unmute();
            }
        });
    }

    /// Sai da sala. Quem assiste vê a transmissão acabar na hora.
    ///
    /// # Bloqueia
    ///
    /// Até a LiveKit confirmar (ou falhar).
    pub fn close(self) {
        drop(self._requests);
        if let Err(error) = async_runtime::block_on(self.room.close()) {
            warn!(target: "media", %error, "a :screen não saiu da sala direito");
        }
        info!(target: "media", "a :screen saiu da sala");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copia_as_linhas_respeitando_o_stride() {
        let src = [1, 2, 3, 4, 5, 6];
        let mut dst = [0u8; 8];
        copy_plane(&src, &mut dst, 3, 4);
        assert_eq!(dst, [1, 2, 3, 0, 4, 5, 6, 0]);
    }

    #[test]
    fn o_token_nao_vai_para_o_log() {
        let target = ShareTarget {
            url: "wss://exemplo".into(),
            token: "segredo".into(),
            track_name: "screen-share:{}".into(),
        };
        let printed = format!("{target:?}");
        assert!(printed.contains("wss://exemplo"));
        assert!(!printed.contains("segredo"), "{printed}");
    }

    #[test]
    fn le_o_destino_do_frontend() {
        let target: ShareTarget = serde_json::from_str(
            r#"{ "url": "wss://x", "token": "t", "trackName": "screen-share:{}" }"#,
        )
        .unwrap();
        assert_eq!(target.track_name, "screen-share:{}");
    }
}
