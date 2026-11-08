//! O destino de diagnóstico do áudio: não envia nada, só registra no log (target "perf") um
//! resumo do que recebe, uma vez por segundo. Serve para testar a captura de áudio sozinha, sem a
//! LiveKit no meio. (O do vídeo é o `H264File`, em `encoded.rs`.)
//!
//! Para ver os relatórios: `RUST_LOG=info,perf=debug`.

use std::time::{Duration, Instant};

use tracing::debug;

use super::{AudioSink, SinkStatus, AUDIO_CHANNELS};

const REPORT_EVERY: Duration = Duration::from_secs(1);

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
