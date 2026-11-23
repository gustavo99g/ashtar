//! O vídeo da transmissão: ponto de entrada comum do pipeline da GPU (ADR 0018).
//!
//! ```text
//! WGC (textura) → VideoProcessor (redução e NV12, na GPU) → encoder H.264 de hardware → PacketSink
//!                                                        ↘ (plano B) NV12 na memória → PacketSink
//! ```
//!
//! A implementação mora em `platform/` (`win32/pipeline.rs`). Daqui saem os tipos que o resto do
//! app usa: o formato pedido ([`VideoFormat`]), os comandos do meio da transmissão
//! ([`VideoCommand`], pelo [`VideoControl`]) e os números para o painel e o log ([`VideoStats`]).

use std::collections::VecDeque;
use std::sync::{mpsc, Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::encoded::PacketSink;
use super::sources::SourceRef;
use super::{platform, CaptureHandle, OnEnd};
use crate::error::AppError;

/// Maior fps aceito (o teto da fase é 1080p60).
pub const MAX_FPS: u32 = 60;
/// Menor lado aceito, da caixa e da imagem.
pub const MIN_SIDE: u32 = 16;
/// Sem imagem nova (tela parada, janela minimizada), a última é codificada de novo a cada tanto:
/// quem entra depois recebe imagem logo.
pub const RESEND_AFTER: Duration = Duration::from_secs(1);

/// O que o preset pede ao vídeo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VideoFormat {
    /// A caixa: a imagem é reduzida para caber nela, sem ampliar ([`fit_in_box`]).
    pub max_width: u32,
    pub max_height: u32,
    pub fps: u32,
    /// O bitrate do começo e o teto: depois, quem manda é a LiveKit
    /// ([`VideoCommand::TargetBitrate`]), sem passar disto.
    pub bitrate_bps: u32,
}

impl VideoFormat {
    pub fn validate(&self) -> Result<(), AppError> {
        if !(1..=MAX_FPS).contains(&self.fps) {
            return Err(AppError::VideoCapture(format!(
                "fps inválido: {}",
                self.fps
            )));
        }
        if self.max_width < MIN_SIDE || self.max_height < MIN_SIDE {
            return Err(AppError::VideoCapture(format!(
                "caixa inválida: {}x{}",
                self.max_width, self.max_height
            )));
        }
        if self.bitrate_bps == 0 {
            return Err(AppError::VideoCapture("bitrate zero".into()));
        }
        Ok(())
    }

    /// O tempo entre um frame e o próximo.
    pub fn frame_interval(&self) -> Duration {
        Duration::from_secs(1) / self.fps
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VideoConfig {
    pub source: SourceRef,
    pub format: VideoFormat,
    pub cursor: bool,
    /// A pessoa pediu para não usar o encoder da placa (Configurações › Voz e vídeo): plano B.
    pub software_encoder: bool,
}

/// O que dá para mudar com a transmissão no ar. A trilha na LiveKit continua a mesma.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoCommand {
    /// O próximo frame sai como keyframe (alguém entrou, ou a rede perdeu pacotes).
    Keyframe,
    /// O alvo novo da estimativa de banda da LiveKit, em bits por segundo.
    TargetBitrate(u32),
    /// Outro preset: a conversão e o encoder são recriados no tamanho e no fps novos.
    Format(VideoFormat),
    /// Outra janela ou tela: só a captura muda.
    Source(SourceRef),
    Cursor(bool),
    /// Pausada, o pipeline para de mandar imagem (o publicador silencia a trilha, e quem assiste
    /// vê "Transmissão pausada"). Na volta, o primeiro frame sai como keyframe.
    Paused(bool),
}

/// Manda comandos ao pipeline de qualquer thread. Um pipeline que já acabou só ignora.
#[derive(Clone)]
pub struct VideoControl {
    commands: mpsc::Sender<VideoCommand>,
}

impl VideoControl {
    pub fn new() -> (Self, mpsc::Receiver<VideoCommand>) {
        let (commands, rx) = mpsc::channel();
        (Self { commands }, rx)
    }

    pub fn send(&self, command: VideoCommand) {
        let _ = self.commands.send(command);
    }
}

/// Quem está codificando.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "name", rename_all = "camelCase")]
pub enum EncoderKind {
    /// O encoder de hardware da placa, pelo nome do Media Foundation ("AMDh264Encoder").
    Hardware(String),
    /// O plano B: o codificador de software do libwebrtc.
    Software,
}

/// Os números do pipeline, escritos pela thread do vídeo e lidos pelo painel e pelo log.
#[derive(Clone)]
pub struct VideoStats(Arc<Mutex<StatsInner>>);

struct StatsInner {
    encoder: EncoderKind,
    adapter: String,
    width: u32,
    height: u32,
    target_bps: u32,
    paused: bool,
    /// Os frames do último segundo: quando saíram, quantos bytes e quanto levaram da captura até
    /// sair do encoder.
    recent: VecDeque<(Instant, usize, Duration)>,
    keyframes: u64,
    dropped: u64,
}

/// Um retrato do último segundo.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsSnapshot {
    pub encoder: EncoderKind,
    pub adapter: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate_kbps: u32,
    pub target_kbps: u32,
    /// A mediana, da imagem composta pelo Windows até o H.264 pronto.
    pub latency_ms: f64,
    /// Keyframes pedidos desde o começo.
    pub keyframes: u64,
    /// Frames que não entraram no encoder porque ele ainda estava ocupado, desde o começo.
    pub dropped: u64,
    pub paused: bool,
}

const STATS_WINDOW: Duration = Duration::from_secs(1);

impl VideoStats {
    pub fn new(encoder: EncoderKind, adapter: String, target_bps: u32) -> Self {
        Self(Arc::new(Mutex::new(StatsInner {
            encoder,
            adapter,
            width: 0,
            height: 0,
            target_bps,
            paused: false,
            recent: VecDeque::new(),
            keyframes: 0,
            dropped: 0,
        })))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, StatsInner> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn frame(&self, bytes: usize, latency: Duration, now: Instant) {
        let mut inner = self.lock();
        inner.recent.push_back((now, bytes, latency));
        while inner
            .recent
            .front()
            .is_some_and(|(at, _, _)| now.duration_since(*at) > STATS_WINDOW)
        {
            inner.recent.pop_front();
        }
    }

    pub fn keyframe_requested(&self) {
        self.lock().keyframes += 1;
    }

    pub fn dropped(&self) {
        self.lock().dropped += 1;
    }

    pub fn set_target(&self, bps: u32) {
        self.lock().target_bps = bps;
    }

    pub fn set_size(&self, width: u32, height: u32) {
        let mut inner = self.lock();
        inner.width = width;
        inner.height = height;
    }

    pub fn set_adapter(&self, adapter: String) {
        self.lock().adapter = adapter;
    }

    pub fn set_encoder(&self, encoder: EncoderKind) {
        self.lock().encoder = encoder;
    }

    pub fn set_paused(&self, paused: bool) {
        self.lock().paused = paused;
    }

    pub fn snapshot(&self, now: Instant) -> StatsSnapshot {
        let inner = self.lock();
        let recent: Vec<_> = inner
            .recent
            .iter()
            .filter(|(at, _, _)| now.duration_since(*at) <= STATS_WINDOW)
            .collect();
        let bits: usize = recent.iter().map(|(_, bytes, _)| bytes * 8).sum();
        let mut latencies: Vec<Duration> = recent.iter().map(|(_, _, l)| *l).collect();
        latencies.sort();
        let latency_ms = latencies
            .get(latencies.len() / 2)
            .map_or(0.0, |l| l.as_secs_f64() * 1000.0);
        StatsSnapshot {
            encoder: inner.encoder.clone(),
            adapter: inner.adapter.clone(),
            width: inner.width,
            height: inner.height,
            fps: recent.len() as u32,
            bitrate_kbps: (bits / 1000) as u32,
            target_kbps: inner.target_bps / 1000,
            latency_ms,
            keyframes: inner.keyframes,
            dropped: inner.dropped,
            paused: inner.paused,
        }
    }
}

/// O nome da placa de vídeo, para o `info.txt` do "Enviar logs".
pub fn gpu_name() -> Option<String> {
    super::platform::gpu_name()
}

/// Tamanho final de uma imagem `width` × `height` para caber na caixa, mantendo a proporção.
///
/// Nunca amplia, e devolve sempre lados pares: no NV12 (e no I420) cada amostra de cor cobre um
/// bloco de 2×2 pixels, e os encoders exigem lados pares.
pub fn fit_in_box(width: u32, height: u32, max_width: u32, max_height: u32) -> (u32, u32) {
    // Em u64, as multiplicações abaixo não têm como estourar.
    let (w, h) = (u64::from(width), u64::from(height));
    let (mw, mh) = (u64::from(max_width), u64::from(max_height));

    let (w, h) = if w <= mw && h <= mh {
        (w, h) // já cabe: fica como está
    } else if w * mh > h * mw {
        (mw, h * mw / w) // proporcionalmente mais larga que a caixa: a largura limita
    } else {
        (w * mh / h, mh) // mais alta que a caixa: a altura limita
    };
    (even(w), even(h))
}

/// O tamanho para o encoder da placa: os lados de [`fit_in_box`] arredondados para baixo até um
/// múltiplo de 16 (o macrobloco do H.264), com mínimo de 16. O conversor centraliza a imagem com
/// a proporção certa e completa a sobra (no máximo 15 pixels por lado) com preto.
///
/// Alguns encoders de hardware (o da AMD na RX 7000, por exemplo) leem a textura com um
/// alinhamento próprio e mandam a imagem toda preta ou embaralhada quando o lado não é múltiplo
/// de 16. Os outros aceitam qualquer lado par, então alinhar sempre não custa nada.
pub fn align_for_hardware((width, height): (u32, u32)) -> (u32, u32) {
    ((width & !15).max(16), (height & !15).max(16))
}

/// Arredonda para baixo até um número par, com mínimo de 2.
fn even(side: u64) -> u32 {
    (side as u32 & !1).max(2)
}

/// Onde uma imagem `input` fica dentro de uma saída de tamanho fixo `output`: o maior retângulo
/// com a proporção da imagem que cabe, no meio, como `(x, y, largura, altura)`. Aqui pode ampliar:
/// uma janela que encolheu no meio da transmissão continua ocupando a saída.
///
/// Posição e tamanho saem sempre pares: no NV12 a cor cobre blocos de 2×2, e um retângulo ímpar
/// borraria a borda do conteúdo.
pub fn letterbox(input: (u32, u32), output: (u32, u32)) -> (u32, u32, u32, u32) {
    let (iw, ih) = (u64::from(input.0.max(1)), u64::from(input.1.max(1)));
    let (ow, oh) = (u64::from(output.0), u64::from(output.1));
    let (w, h) = if iw * oh > ih * ow {
        (ow, (ih * ow / iw).min(oh)) // mais larga: faixas em cima e embaixo
    } else {
        ((iw * oh / ih).min(ow), oh) // mais alta: faixas dos lados
    };
    let (w, h) = (w as u32 & !1, h as u32 & !1);
    (((output.0 - w) / 2) & !1, ((output.1 - h) / 2) & !1, w, h)
}

/// Menor nível H.264 que comporta `width` × `height` a `fps` (tabela A-1 da norma).
///
/// Vai para o encoder junto com o perfil: sem ele, o encoder pode escolher um nível que não
/// comporta o fps pedido (o 4.1 vai só até 1080p30) e orçar o bitrate como se fosse o fps máximo
/// do nível. Foi o que o `encoder-probe` mostrou na placa AMD.
pub fn h264_level(width: u32, height: u32, fps: u32) -> u32 {
    // (nível ×10, macroblocos por segundo, macroblocos por frame)
    const LEVELS: [(u32, u64, u64); 9] = [
        (30, 40_500, 1_620),
        (31, 108_000, 3_600),
        (32, 216_000, 5_120),
        (40, 245_760, 8_192),
        (41, 245_760, 8_192),
        (42, 522_240, 8_704),
        (50, 589_824, 22_080),
        (51, 983_040, 36_864),
        (52, 2_073_600, 36_864),
    ];
    let frame = u64::from(width.div_ceil(16)) * u64::from(height.div_ceil(16));
    let per_second = frame * u64::from(fps);
    LEVELS
        .iter()
        .find(|(_, mbps, fs)| per_second <= *mbps && frame <= *fs)
        .map_or(52, |(level, _, _)| *level)
}

/// Inicia o vídeo da transmissão, entregando cada pacote ao `sink`. Devolve o controle (para os
/// comandos do meio) e os números.
///
/// Sem encoder de hardware, com `software_encoder` no `config`, ou com
/// `ASHTAR_FORCE_SOFTWARE_ENCODER=1` no ambiente, entra o plano B
/// (os pacotes saem como `RawFrame`). Uma fonte que não existe falha com `SourceNotFound`.
///
/// # Bloqueia
///
/// Espera a captura, a conversão e o encoder começarem. Só chamar dentro de `spawn_blocking`.
pub fn spawn_video(
    config: VideoConfig,
    sink: impl PacketSink,
    on_end: OnEnd,
) -> Result<(CaptureHandle, VideoControl, VideoStats), AppError> {
    config.format.validate()?;
    let force_software = config.software_encoder
        || std::env::var("ASHTAR_FORCE_SOFTWARE_ENCODER").is_ok_and(|v| v == "1");
    platform::spawn_video(config, force_software, sink, on_end)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn format(fps: u32, max_width: u32, max_height: u32) -> VideoFormat {
        VideoFormat {
            max_width,
            max_height,
            fps,
            bitrate_bps: 8_000_000,
        }
    }

    #[test]
    fn reduz_para_caber_na_caixa() {
        assert_eq!(fit_in_box(3840, 2160, 1920, 1080), (1920, 1080));
        assert_eq!(fit_in_box(2560, 1440, 1600, 900), (1600, 900));
        // Ultrawide: a largura limita. 1440 × 1920 / 3440 = 803,7 → 803 → par: 802.
        assert_eq!(fit_in_box(3440, 1440, 1920, 1080), (1920, 802));
        // Janela alta e estreita: a altura limita.
        assert_eq!(fit_in_box(500, 2000, 1920, 1080), (270, 1080));
    }

    #[test]
    fn nunca_amplia() {
        assert_eq!(fit_in_box(1280, 720, 1920, 1080), (1280, 720));
        assert_eq!(fit_in_box(800, 600, 1920, 1080), (800, 600));
    }

    #[test]
    fn dimensoes_sempre_pares_e_nunca_zero() {
        assert_eq!(fit_in_box(1001, 601, 1920, 1080), (1000, 600));
        // Tão estreita que a largura reduzida daria 1: o mínimo é 2.
        assert_eq!(fit_in_box(16, 10_000, 1920, 1080), (2, 1080));
    }

    #[test]
    fn tamanho_do_encoder_de_hardware_em_multiplos_de_16() {
        assert_eq!(align_for_hardware((1920, 1080)), (1920, 1072));
        assert_eq!(align_for_hardware((1280, 720)), (1280, 720));
        // Uma janela qualquer (1918 × 1036 depois do `fit_in_box`).
        assert_eq!(align_for_hardware((1918, 1036)), (1904, 1024));
        // Nunca abaixo de um macrobloco.
        assert_eq!(align_for_hardware((2, 1080)), (16, 1072));
    }

    #[test]
    fn nivel_h264_pelo_tamanho_e_fps() {
        assert_eq!(h264_level(1920, 1080, 30), 40);
        assert_eq!(h264_level(1920, 1080, 60), 42);
        assert_eq!(h264_level(1280, 720, 60), 32);
        assert_eq!(h264_level(1600, 900, 60), 42);
        // 1080p60 de ultrawide reduzido (1920 × 802) também cabe no 4.2.
        assert_eq!(h264_level(1920, 802, 60), 42);
    }

    #[test]
    fn mesma_proporcao_ocupa_tudo() {
        assert_eq!(letterbox((3840, 2160), (1920, 1080)), (0, 0, 1920, 1080));
        assert_eq!(letterbox((1280, 720), (1920, 1080)), (0, 0, 1920, 1080));
    }

    #[test]
    fn outra_proporcao_fica_no_meio_com_bordas() {
        // A janela ficou quadrada numa saída 16:9: faixas dos lados.
        assert_eq!(letterbox((1000, 1000), (1920, 1080)), (420, 0, 1080, 1080));
        // Ficou ultrawide: faixas em cima e embaixo.
        assert_eq!(letterbox((3440, 1440), (1920, 1080)), (0, 138, 1920, 802));
    }

    #[test]
    fn o_retangulo_das_bordas_e_sempre_par() {
        for input in [(1001, 777), (3439, 1441), (999, 1999), (17, 9)] {
            let (x, y, w, h) = letterbox(input, (1920, 1080));
            assert!(
                [x, y, w, h].iter().all(|v| v % 2 == 0),
                "{input:?}: {x} {y} {w} {h}"
            );
            assert!(x + w <= 1920 && y + h <= 1080);
        }
    }

    #[test]
    fn recusa_formato_invalido() {
        assert!(format(60, 1920, 1080).validate().is_ok());
        assert!(format(0, 1920, 1080).validate().is_err());
        assert!(format(61, 1920, 1080).validate().is_err());
        assert!(format(30, 0, 1080).validate().is_err());
        let zero = VideoFormat {
            bitrate_bps: 0,
            ..format(60, 1920, 1080)
        };
        assert!(zero.validate().is_err());
    }

    #[test]
    fn intervalo_entre_frames() {
        assert_eq!(
            format(30, 1920, 1080).frame_interval(),
            Duration::from_nanos(33_333_333)
        );
        assert_eq!(
            format(60, 1920, 1080).frame_interval(),
            Duration::from_nanos(16_666_666)
        );
    }

    #[test]
    fn numeros_do_ultimo_segundo() {
        let stats = VideoStats::new(
            EncoderKind::Hardware("Teste".into()),
            "Placa".into(),
            8_000_000,
        );
        let start = Instant::now();
        // 2 s a 60 fps, cada frame com 10 kB e 5 ms; só o último segundo conta.
        for i in 0..120u32 {
            let at = start + Duration::from_secs(2) * i / 120;
            stats.frame(10_000, Duration::from_millis(5), at);
        }
        stats.keyframe_requested();
        let now = start + Duration::from_secs(2) * 119 / 120;
        let snapshot = stats.snapshot(now);
        assert!((60..=61).contains(&snapshot.fps), "{}", snapshot.fps);
        assert!(
            (4_800..=4_880).contains(&snapshot.bitrate_kbps),
            "{}",
            snapshot.bitrate_kbps
        );
        assert_eq!(snapshot.target_kbps, 8_000);
        assert_eq!(snapshot.latency_ms, 5.0);
        assert_eq!(snapshot.keyframes, 1);

        // Um segundo e pouco sem frame: zera.
        let later = stats.snapshot(now + Duration::from_millis(1500));
        assert_eq!((later.fps, later.bitrate_kbps), (0, 0));
    }

    #[test]
    fn o_encoder_vai_para_o_painel_com_o_nome() {
        assert_eq!(
            serde_json::to_value(EncoderKind::Hardware("AMDh264Encoder".into())).unwrap(),
            serde_json::json!({ "kind": "hardware", "name": "AMDh264Encoder" })
        );
        assert_eq!(
            serde_json::to_value(EncoderKind::Software).unwrap(),
            serde_json::json!({ "kind": "software" })
        );
    }
}
