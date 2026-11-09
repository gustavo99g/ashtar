//! O bitrate do encoder corrigido pelo medido (ADR 0018).
//!
//! O encoder de hardware orça cada frame como "bitrate ÷ fps configurado". Só que o pipeline só
//! codifica imagens novas: um vídeo de 30 fps tocando numa transmissão de 60 fps manda metade dos
//! frames, e sai com metade do bitrate pedido. O [`BitrateController`] mede o que saiu de verdade
//! a cada segundo e corrige o valor passado ao encoder para chegar ao alvo (o que a LiveKit
//! pede, pela estimativa de banda).
//!
//! - Ajusta no máximo uma vez por segundo, e só metade do caminho de cada vez: o encoder demora
//!   alguns frames para obedecer, e corrigir tudo de uma vez faria o valor oscilar.
//! - Fica entre metade e o dobro do alvo.
//! - Com a tela quase parada (menos da metade dos frames do fps), não mexe: ali o encoder não
//!   gasta o orçamento porque não há o que codificar, e subir o valor só faria a próxima cena com
//!   movimento sair acima do alvo.
//!
//! Não depende de plataforma, nem do relógio: quem chama passa o `Instant` de cada frame.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// De quanto em quanto tempo o bitrate é medido e, se preciso, corrigido.
const WINDOW: Duration = Duration::from_secs(1);
/// Diferença do alvo que não vale corrigir.
const TOLERANCE: f64 = 0.10;
/// Que parte da diferença cada correção anda.
const GAIN: f64 = 0.5;
const MIN_FACTOR: f64 = 0.5;
const MAX_FACTOR: f64 = 2.0;

#[derive(Debug)]
pub struct BitrateController {
    /// O que se quer que saia, em bits por segundo.
    target: u32,
    /// O que está configurado no encoder agora.
    setpoint: u32,
    fps: u32,
    /// Os frames desde a última correção: quando chegaram e quantos bytes tinham.
    frames: VecDeque<(Instant, usize)>,
    since: Instant,
}

impl BitrateController {
    /// Começa com o encoder configurado no próprio alvo.
    pub fn new(target_bps: u32, fps: u32, now: Instant) -> Self {
        Self {
            target: target_bps.max(1),
            setpoint: target_bps.max(1),
            fps: fps.max(1),
            frames: VecDeque::new(),
            since: now,
        }
    }

    /// O valor que deve estar configurado no encoder.
    #[cfg(test)]
    pub fn setpoint(&self) -> u32 {
        self.setpoint
    }

    #[cfg(test)]
    pub fn target(&self) -> u32 {
        self.target
    }

    /// Alvo novo (a LiveKit pediu menos, ou mais). A correção que já existia é mantida em
    /// proporção: se o encoder precisava de 1,5× o alvo para chegar nele, continua precisando.
    /// Devolve o valor novo do encoder, se mudou.
    pub fn set_target(&mut self, target_bps: u32, now: Instant) -> Option<u32> {
        let target_bps = target_bps.max(1);
        if target_bps == self.target {
            return None;
        }
        let ratio = f64::from(self.setpoint) / f64::from(self.target);
        self.target = target_bps;
        self.restart(now);
        self.apply(f64::from(target_bps) * ratio)
    }

    /// Um frame codificado com `bytes` bytes. Devolve o valor novo do encoder, se for hora de
    /// corrigir.
    pub fn on_frame(&mut self, bytes: usize, now: Instant) -> Option<u32> {
        self.frames.push_back((now, bytes));
        if now.duration_since(self.since) < WINDOW {
            return None;
        }
        while self
            .frames
            .front()
            .is_some_and(|(at, _)| now.duration_since(*at) > WINDOW)
        {
            self.frames.pop_front();
        }

        let frames = self.frames.len() as u32;
        if frames * 2 < self.fps {
            // Tela quase parada: só recomeça a medir daqui.
            self.restart(now);
            return None;
        }

        let bits: f64 = self.frames.iter().map(|(_, b)| *b as f64 * 8.0).sum();
        let measured = bits / WINDOW.as_secs_f64();
        let target = f64::from(self.target);
        if measured <= 0.0 || (measured / target - 1.0).abs() < TOLERANCE {
            return None;
        }

        let current = f64::from(self.setpoint);
        let wanted = current * target / measured;
        self.restart(now);
        self.apply(current + GAIN * (wanted - current))
    }

    fn restart(&mut self, now: Instant) {
        self.frames.clear();
        self.since = now;
    }

    /// Guarda o valor novo, dentro dos limites; devolve-o se mudou.
    fn apply(&mut self, value: f64) -> Option<u32> {
        let target = f64::from(self.target);
        let value = value
            .clamp(target * MIN_FACTOR, target * MAX_FACTOR)
            .round() as u32;
        if value == self.setpoint {
            return None;
        }
        self.setpoint = value;
        Some(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MBPS: u32 = 1_000_000;

    /// Manda `seconds` segundos de frames de `bytes` bytes a `fps` frames por segundo, a partir de
    /// `*clock`, e devolve os valores que o controlador mandou configurar.
    fn feed(
        controller: &mut BitrateController,
        clock: &mut Instant,
        fps: u32,
        bytes: usize,
        seconds: u32,
    ) -> Vec<u32> {
        let step = Duration::from_secs(1) / fps;
        let mut changes = Vec::new();
        for _ in 0..fps * seconds {
            *clock += step;
            changes.extend(controller.on_frame(bytes, *clock));
        }
        changes
    }

    /// Bytes por frame de um encoder obediente: o valor configurado ÷ o fps configurado.
    fn obedient(setpoint: u32, configured_fps: u32) -> usize {
        (setpoint / configured_fps / 8) as usize
    }

    #[test]
    fn no_alvo_nao_mexe() {
        let mut clock = Instant::now();
        let mut c = BitrateController::new(8 * MBPS, 60, clock);
        let changes = feed(&mut c, &mut clock, 60, obedient(8 * MBPS, 60), 5);
        assert!(changes.is_empty(), "{changes:?}");
        assert_eq!(c.setpoint(), 8 * MBPS);
    }

    #[test]
    fn com_metade_dos_frames_sobe_ate_chegar_no_alvo() {
        // Um vídeo de 30 fps numa transmissão de 60: cada frame sai com o orçamento de 1/60.
        let mut clock = Instant::now();
        let mut c = BitrateController::new(8 * MBPS, 60, clock);
        for _ in 0..10 {
            let bytes = obedient(c.setpoint(), 60);
            feed(&mut c, &mut clock, 30, bytes, 1);
        }
        let measured = obedient(c.setpoint(), 60) as f64 * 8.0 * 30.0;
        assert!(
            (measured / f64::from(8 * MBPS) - 1.0).abs() < TOLERANCE,
            "mediu {measured}, configurado {}",
            c.setpoint()
        );
        assert!(c.setpoint() > 14 * MBPS && c.setpoint() <= 16 * MBPS);
    }

    #[test]
    fn nunca_passa_do_dobro_nem_da_metade() {
        let mut clock = Instant::now();
        let mut c = BitrateController::new(8 * MBPS, 60, clock);
        // Um encoder que sempre entrega um décimo do pedido.
        feed(&mut c, &mut clock, 60, obedient(8 * MBPS, 600), 20);
        assert_eq!(c.setpoint(), 16 * MBPS);
        // E um que sempre entrega dez vezes o pedido.
        feed(&mut c, &mut clock, 60, obedient(8 * MBPS, 6), 20);
        assert_eq!(c.setpoint(), 4 * MBPS);
    }

    #[test]
    fn tela_parada_nao_mexe() {
        let mut clock = Instant::now();
        let mut c = BitrateController::new(8 * MBPS, 60, clock);
        // Um frame por segundo, minúsculo: o reenvio da tela parada.
        let changes = feed(&mut c, &mut clock, 1, 2_000, 10);
        assert!(changes.is_empty(), "{changes:?}");
        assert_eq!(c.setpoint(), 8 * MBPS);
    }

    #[test]
    fn alvo_novo_mantem_a_correcao_em_proporcao() {
        let mut clock = Instant::now();
        let mut c = BitrateController::new(8 * MBPS, 60, clock);
        for _ in 0..10 {
            let bytes = obedient(c.setpoint(), 60);
            feed(&mut c, &mut clock, 30, bytes, 1);
        }
        let ratio = f64::from(c.setpoint()) / f64::from(8 * MBPS);

        let changed = c.set_target(4 * MBPS, clock).expect("deveria mudar");
        assert_eq!(c.target(), 4 * MBPS);
        assert!((f64::from(changed) / f64::from(4 * MBPS) - ratio).abs() < 0.01);
        assert_eq!(
            c.set_target(4 * MBPS, clock),
            None,
            "o mesmo alvo não muda nada"
        );
    }

    #[test]
    fn espera_um_segundo_inteiro_antes_de_corrigir() {
        let mut clock = Instant::now();
        let mut c = BitrateController::new(8 * MBPS, 60, clock);
        let step = Duration::from_secs(1) / 60;
        for _ in 0..59 {
            clock += step;
            assert_eq!(c.on_frame(1_000_000, clock), None);
        }
    }
}
