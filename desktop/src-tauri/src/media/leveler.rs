//! O nivelador do áudio da transmissão: sobe o som do jogo até perto do nível da voz, sem
//! estourar.
//!
//! O WASAPI entrega o som no nível em que o Windows o mistura, e o jogo costuma vir bem abaixo da
//! voz, que passa pelo controle de ganho do WebRTC. Sem nivelar, quem assiste ouve a voz alta e o
//! jogo baixo, e quem transmite precisa aumentar o próprio som para compensar.
//!
//! - **Só sobe, nunca abaixa:** o ganho vai de 1× a [`MAX_GAIN`] (+12 dB). Um som já alto passa
//!   como está.
//! - **Devagar para subir, rápido para descer:** a média de volume acompanha um som que fica mais
//!   alto em ~0,2 s e um que fica mais baixo em ~1,5 s; o ganho sobe 3 dB por segundo e desce 20 dB
//!   por segundo. Uma explosão depois de um trecho calmo não chega estourada, e o ganho não
//!   "bombeia" a cada passo.
//! - **O silêncio não conta:** abaixo de [`GATE`], o ganho fica onde estava, para não subir o
//!   chiado de fundo quando o jogo fica quieto.
//! - **Limitador por amostra:** acima de [`LIMIT`], a onda é arredondada (curva suave) em vez de
//!   cortada, e nunca passa de 1,0.
//!
//! Desligado (a chave "Nivelar o volume"), o som passa cru, como antes.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use super::{AUDIO_CHANNELS, AUDIO_SAMPLE_RATE};

/// O volume médio (RMS) que o nivelador busca: ~-18 dBFS.
pub const TARGET_RMS: f32 = 0.125;
/// O ganho máximo: 4× (+12 dB).
pub const MAX_GAIN: f32 = 4.0;
/// Abaixo deste volume médio (~-50 dBFS) é silêncio: o ganho não muda.
pub const GATE: f32 = 0.003;
/// A partir daqui (~-2 dBFS) o limitador arredonda a onda.
pub const LIMIT: f32 = 0.8;

/// Em quanto tempo a média de volume acompanha um som mais alto e um mais baixo, em segundos.
const ATTACK_SECONDS: f32 = 0.2;
const RELEASE_SECONDS: f32 = 1.5;
/// Quanto o ganho sobe e desce por segundo, em dB.
const RISE_DB_PER_SECOND: f32 = 3.0;
const FALL_DB_PER_SECOND: f32 = 20.0;

pub struct Leveler {
    enabled: Arc<AtomicBool>,
    /// A média do quadrado das amostras (o volume médio ao quadrado).
    mean_square: f32,
    gain: f32,
    attack: f32,
    release: f32,
    rise: f32,
    fall: f32,
}

impl Leveler {
    /// `enabled` é a chave, que o manager troca no meio da transmissão.
    pub fn new(enabled: Arc<AtomicBool>) -> Self {
        let rate = AUDIO_SAMPLE_RATE as f32;
        Self {
            enabled,
            mean_square: 0.0,
            gain: 1.0,
            attack: 1.0 - (-1.0 / (ATTACK_SECONDS * rate)).exp(),
            release: 1.0 - (-1.0 / (RELEASE_SECONDS * rate)).exp(),
            rise: db_to_gain(RISE_DB_PER_SECOND / rate),
            fall: db_to_gain(-FALL_DB_PER_SECOND / rate),
        }
    }

    /// O ganho de agora, em dB (para o log).
    pub fn gain_db(&self) -> f32 {
        20.0 * self.gain.log10()
    }

    /// Nivela `samples` (intercaladas, [`AUDIO_CHANNELS`] canais) no lugar.
    pub fn process(&mut self, samples: &mut [f32]) {
        if !self.enabled.load(Ordering::Relaxed) {
            // Desligado volta ao começo: ao religar, sobe de novo devagar.
            self.gain = 1.0;
            return;
        }
        for frame in samples.chunks_mut(AUDIO_CHANNELS) {
            let energy = frame.iter().map(|s| s * s).sum::<f32>() / frame.len() as f32;
            let alpha = if energy > self.mean_square {
                self.attack
            } else {
                self.release
            };
            self.mean_square += alpha * (energy - self.mean_square);

            let level = self.mean_square.sqrt();
            if level > GATE {
                let wanted = (TARGET_RMS / level).clamp(1.0, MAX_GAIN);
                self.gain = if wanted > self.gain {
                    (self.gain * self.rise).min(wanted)
                } else {
                    (self.gain * self.fall).max(wanted)
                };
            }
            for sample in frame {
                *sample = limit(*sample * self.gain);
            }
        }
    }
}

fn db_to_gain(db: f32) -> f32 {
    10f32.powf(db / 20.0)
}

/// Até [`LIMIT`], passa igual; acima, arredonda até no máximo 1,0.
fn limit(sample: f32) -> f32 {
    let size = sample.abs();
    if size <= LIMIT {
        return sample;
    }
    let room = 1.0 - LIMIT;
    (LIMIT + room * ((size - LIMIT) / room).tanh()).copysign(sample)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leveler(enabled: bool) -> Leveler {
        Leveler::new(Arc::new(AtomicBool::new(enabled)))
    }

    /// `seconds` de um seno de 440 Hz em estéreo, com o pico em `peak`.
    fn tone(peak: f32, seconds: f32) -> Vec<f32> {
        let rate = AUDIO_SAMPLE_RATE as f32;
        let frames = (seconds * rate) as usize;
        (0..frames)
            .flat_map(|i| {
                let s = peak * (2.0 * std::f32::consts::PI * 440.0 * i as f32 / rate).sin();
                [s, s]
            })
            .collect()
    }

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
    }

    /// Passa `samples` em pedaços de 10 ms, como o WASAPI entrega.
    fn run(leveler: &mut Leveler, samples: &mut [f32]) {
        for chunk in samples.chunks_mut(480 * AUDIO_CHANNELS) {
            leveler.process(chunk);
        }
    }

    #[test]
    fn um_jogo_baixo_sobe_ate_perto_do_alvo() {
        // Pico de 0,05: RMS ~0,035 (~-29 dBFS), 11 dB abaixo do alvo.
        let mut samples = tone(0.05, 8.0);
        let mut l = leveler(true);
        run(&mut l, &mut samples);
        let tail = &samples[samples.len() - 48_000 * AUDIO_CHANNELS..];
        let ratio_db = 20.0 * (rms(tail) / TARGET_RMS).log10();
        // A média sobe rápido com os picos, então ela fica um pouco acima do volume de verdade, e o
        // som assenta um pouco abaixo do alvo: é o lado seguro.
        assert!(
            (-3.0..=0.5).contains(&ratio_db),
            "ficou {ratio_db:.1} dB do alvo"
        );
        assert!(l.gain_db() > 8.0, "ganho {}", l.gain_db());
    }

    #[test]
    fn nunca_passa_de_12_db() {
        let mut samples = tone(0.005, 10.0);
        let mut l = leveler(true);
        run(&mut l, &mut samples);
        assert!((l.gain_db() - 12.0).abs() < 0.1, "ganho {}", l.gain_db());
    }

    #[test]
    fn um_som_alto_passa_como_esta_e_nada_estoura() {
        let original = tone(0.7, 3.0);
        let mut samples = original.clone();
        let mut l = leveler(true);
        run(&mut l, &mut samples);
        // No começo, enquanto a média ainda sobe, o ganho mexe um pouco; depois de 1 s, o som passa
        // como está.
        assert_eq!(l.gain_db(), 0.0);
        let second = 48_000 * AUDIO_CHANNELS;
        assert_eq!(samples[second..], original[second..]);
        assert!(samples.iter().all(|s| s.abs() <= 0.8));

        // Um som que, subido, passaria de 1,0: o limitador segura.
        let mut quiet = tone(0.05, 6.0);
        run(&mut l, &mut quiet);
        let mut bang = tone(1.0, 0.05);
        run(&mut l, &mut bang);
        assert!(bang.iter().all(|s| s.abs() <= 1.0));
    }

    #[test]
    fn o_silencio_nao_sobe_o_ganho() {
        let mut silence = vec![0.0001; 48_000 * AUDIO_CHANNELS * 5];
        let mut l = leveler(true);
        run(&mut l, &mut silence);
        assert_eq!(l.gain_db(), 0.0);
    }

    #[test]
    fn desligado_passa_cru() {
        let original = tone(0.05, 2.0);
        let mut samples = original.clone();
        let mut l = leveler(false);
        run(&mut l, &mut samples);
        assert_eq!(samples, original);
    }

    #[test]
    fn a_chave_vale_no_meio() {
        let flag = Arc::new(AtomicBool::new(true));
        let mut l = Leveler::new(Arc::clone(&flag));
        let mut samples = tone(0.05, 6.0);
        run(&mut l, &mut samples);
        assert!(l.gain_db() > 6.0);

        flag.store(false, Ordering::Relaxed);
        let original = tone(0.05, 0.5);
        let mut after = original.clone();
        run(&mut l, &mut after);
        assert_eq!(after, original);
        assert_eq!(l.gain_db(), 0.0);
    }

    #[test]
    fn o_limitador_e_suave_e_simetrico() {
        assert_eq!(limit(0.5), 0.5);
        assert_eq!(limit(-0.8), -0.8);
        assert!(limit(0.9) > 0.8 && limit(0.9) < 0.9);
        assert!(limit(10.0) <= 1.0);
        assert_eq!(limit(-0.9), -limit(0.9));
    }
}
