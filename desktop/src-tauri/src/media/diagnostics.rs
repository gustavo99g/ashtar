//! Sinks de diagnóstico: não enviam nada, só registram no log (target "perf")
//! um resumo do que recebem, uma vez por segundo.
//!
//! Servem para testar cada captura isoladamente, sem IPC nem LiveKit no meio.
//! As métricas seguem o critério da linha de base (plan.md, Etapa 6): a média de
//! fps sozinha engana, então o sink de vídeo também conta os intervalos longos
//! entre frames.
//!
//! Para ver os relatórios: `RUST_LOG=info,perf=debug`.

use livekit::webrtc::video_frame::VideoBuffer;
use std::time::{Duration, Instant};

use tracing::debug;

use super::{AudioSink, CapturedFrame, SinkStatus, VideoSink, AUDIO_CHANNELS};

const REPORT_EVERY: Duration = Duration::from_secs(1);

// ============================================================================
// Vídeo
// ============================================================================

/// Estatísticas dos intervalos entre frames numa janela de tempo.
///
/// Os limites são cumulativos: um intervalo de 60 ms conta nos três.
/// - acima de 20 ms: passou de um frame a 60 fps (16,7 ms), ou seja, atrasou;
/// - acima de 34 ms: passou de um frame a 30 fps (33,3 ms);
/// - acima de 50 ms: travada visível para quem assiste.
#[derive(Debug, Default, PartialEq)]
struct GapStats {
    max_us: i64,
    over_20ms: u32,
    over_34ms: u32,
    over_50ms: u32,
}

impl GapStats {
    fn record(&mut self, gap_us: i64) {
        self.max_us = self.max_us.max(gap_us);
        if gap_us > 20_000 {
            self.over_20ms += 1;
        }
        if gap_us > 34_000 {
            self.over_34ms += 1;
        }
        if gap_us > 50_000 {
            self.over_50ms += 1;
        }
    }
}

/// Registra fps, resolução e intervalos entre frames.
///
/// O relatório só sai quando chega um frame: se a captura parar de entregar,
/// os logs param, e isso já é o sinal de que algo travou.
pub struct LogVideoSink {
    frames: u32,
    gaps: GapStats,
    last_timestamp_us: Option<i64>,
    last_report: Instant,
}
impl LogVideoSink {
    pub fn new() -> Self {
        Self {
            frames: 0,
            gaps: GapStats::default(),
            last_timestamp_us: None,
            last_report: Instant::now(),
        }
    }
}
impl Default for LogVideoSink {
    fn default() -> Self {
        Self::new()
    }
}

impl VideoSink for LogVideoSink {
    fn push(&mut self, frame: &CapturedFrame) -> SinkStatus {
        self.frames += 1;

        if let Some(previous) = self.last_timestamp_us {
            self.gaps.record(frame.timestamp_us - previous);
        }
        self.last_timestamp_us = Some(frame.timestamp_us);

        let elapsed = self.last_report.elapsed();
        if elapsed >= REPORT_EVERY {
            // Esvazia as estatísticas e as devolve, deixando um GapStats::default() no lugar.
            let gaps = std::mem::take(&mut self.gaps);

            // Se o compilador disser que `width()` não existe no I420Buffer, acrescente
            // `use livekit::webrtc::video_frame::VideoBuffer;` no topo do arquivo.
            debug!(
                target: "perf",
                fps = round1(self.frames as f64 / elapsed.as_secs_f64()),
                width = frame.buffer.width(),
                height = frame.buffer.height(),
                max_gap_ms = round1(gaps.max_us as f64 / 1000.0),
                gaps_over_20ms = gaps.over_20ms,
                gaps_over_34ms = gaps.over_34ms,
                gaps_over_50ms = gaps.over_50ms,
                "video sink"
            );

            self.frames = 0;
            self.last_report = Instant::now();
        }

        SinkStatus::Continue
    }
}

// ============================================================================
// Áudio
// ============================================================================

/// Registra a taxa real de amostras e o nível do sinal.
///
/// A taxa deve ficar perto de 48.000 frames por segundo; bem abaixo disso, a
/// captura está perdendo pacotes. O nível mostra se há áudio de verdade:
/// silêncio fica perto de -100 dB, música tipicamente entre -30 e -6 dB.
pub struct LogAudioSink {
    samples: usize,
    sum_squares: f64,
    peak: f32,
    last_report: Instant,
}

impl LogAudioSink {
    pub fn new() -> Self {
        Self {
            samples: 0,
            sum_squares: 0.0,
            peak: 0.0,
            last_report: Instant::now(),
        }
    }
}

impl Default for LogAudioSink {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioSink for LogAudioSink {
    fn push(&mut self, samples: &[f32]) -> SinkStatus {
        self.samples += samples.len();
        for &sample in samples {
            // Soma em f64: em f32, somar dezenas de milhares de quadrados pequenos perde precisão.
            self.sum_squares += f64::from(sample) * f64::from(sample);
            self.peak = self.peak.max(sample.abs());
        }

        let elapsed = self.last_report.elapsed();
        if elapsed >= REPORT_EVERY {
            let frames_per_sec = (self.samples / AUDIO_CHANNELS) as f64 / elapsed.as_secs_f64();
            let rms = (self.sum_squares / self.samples.max(1) as f64).sqrt();

            debug!(
                target: "perf",
                rate = frames_per_sec.round() as u32,
                rms_db = round1(to_dbfs(rms)),
                peak_db = round1(to_dbfs(f64::from(self.peak))),
                "audio sink"
            );

            self.samples = 0;
            self.sum_squares = 0.0;
            self.peak = 0.0;
            self.last_report = Instant::now();
        }

        SinkStatus::Continue
    }
}

// ============================================================================
// Auxiliares
// ============================================================================

/// Converte um nível linear (0.0 a 1.0) em dBFS, com piso de -100 dB para o silêncio.
fn to_dbfs(level: f64) -> f64 {
    20.0 * level.max(1e-5).log10()
}

/// Arredonda para uma casa decimal, para os logs ficarem legíveis.
fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intervalos_sao_contados_de_forma_cumulativa() {
        let mut gaps = GapStats::default();
        gaps.record(16_700); // frame no ritmo de 60 fps: não conta
        gaps.record(25_000); // atrasou: só acima de 20 ms
        gaps.record(40_000); // acima de 20 e de 34 ms
        gaps.record(80_000); // acima dos três

        assert_eq!(
            gaps,
            GapStats {
                max_us: 80_000,
                over_20ms: 3,
                over_34ms: 2,
                over_50ms: 1,
            }
        );
    }

    #[test]
    fn take_zera_as_estatisticas() {
        let mut gaps = GapStats::default();
        gaps.record(60_000);

        let taken = std::mem::take(&mut gaps);

        assert_eq!(taken.over_50ms, 1);
        assert_eq!(gaps, GapStats::default());
    }

    #[test]
    fn converte_niveis_para_dbfs() {
        assert_eq!(round1(to_dbfs(1.0)), 0.0);
        assert_eq!(round1(to_dbfs(0.5)), -6.0);
        assert_eq!(round1(to_dbfs(0.0)), -100.0);
    }

    #[test]
    fn sink_de_audio_sempre_continua() {
        let mut sink = LogAudioSink::new();
        let silencio = vec![0.0_f32; 960];
        assert!(matches!(sink.push(&silencio), SinkStatus::Continue));
    }
}
