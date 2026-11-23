//! O aviso "Sua transmissão está saindo preta" (decisão 26 do plano da v0.8): um filme com
//! proteção (DRM) ou um jogo em tela cheia exclusiva sai todo preto na captura, e quem transmite
//! não percebe. A miniatura da própria fonte é conferida uma vez por segundo; 5 segundos seguidos
//! de imagem toda preta viram o aviso, e a primeira imagem com conteúdo o desfaz.
//!
//! "Toda preta" é escuro **e** sem nada mais claro: uma cena escura de jogo tem a interface, uma
//! luz, um texto, e não conta.

use std::time::{Duration, Instant};

/// Quanto tempo de preto até avisar.
pub const BLACK_FOR: Duration = Duration::from_secs(5);
/// De quanto em quanto tempo uma miniatura é conferida.
pub const CHECK_EVERY: Duration = Duration::from_secs(1);

/// A média de brilho (0 a 255) abaixo da qual a imagem é escura.
const DARK_AVERAGE: f64 = 6.0;
/// O pixel mais claro de uma imagem toda preta: acima disso, tem alguma coisa ali (e o JPEG deixa
/// um pouco de ruído perto do zero).
const DARK_MAX: u8 = 24;

/// Se a imagem (RGB, 3 bytes por pixel) é toda preta.
pub fn looks_black(rgb: &[u8]) -> bool {
    let (pixels, _) = rgb.as_chunks::<3>();
    if pixels.is_empty() {
        return false;
    }
    let mut total = 0u64;
    for &[r, g, b] in pixels {
        // O brilho como o olho vê (BT.601), em inteiros.
        let luma = ((299 * u32::from(r) + 587 * u32::from(g) + 114 * u32::from(b)) / 1000) as u8;
        if luma > DARK_MAX {
            return false;
        }
        total += u64::from(luma);
    }
    (total as f64 / pixels.len() as f64) < DARK_AVERAGE
}

/// Conta o tempo de preto e diz quando o aviso muda.
#[derive(Debug, Default)]
pub struct BlackWatch {
    black_since: Option<Instant>,
    reported: bool,
}

impl BlackWatch {
    /// Uma imagem nova em `now`. Devolve `Some(true)` quando começa a sair preta (uma vez) e
    /// `Some(false)` quando volta a ter imagem depois do aviso.
    pub fn see(&mut self, black: bool, now: Instant) -> Option<bool> {
        if black {
            let since = *self.black_since.get_or_insert(now);
            if !self.reported && now.duration_since(since) >= BLACK_FOR {
                self.reported = true;
                return Some(true);
            }
            return None;
        }
        self.black_since = None;
        if self.reported {
            self.reported = false;
            return Some(false);
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image(pixel: [u8; 3], count: usize) -> Vec<u8> {
        pixel.repeat(count)
    }

    #[test]
    fn preto_de_verdade_e_cena_escura() {
        assert!(looks_black(&image([0, 0, 0], 100)));
        // O ruído do JPEG perto do zero continua preto.
        assert!(looks_black(&image([3, 2, 4], 100)));
        // Uma cena escura com um texto claro (a interface do jogo) não é preta.
        let mut scene = image([4, 4, 6], 100);
        scene.extend_from_slice(&[200, 200, 200]);
        assert!(!looks_black(&scene));
        // Escura por igual, mas não preta.
        assert!(!looks_black(&image([15, 15, 15], 100)));
        assert!(!looks_black(&[]));
    }

    #[test]
    fn cinco_segundos_pretos_avisam_uma_vez() {
        let start = Instant::now();
        let at = |s: u64| start + Duration::from_secs(s);
        let mut watch = BlackWatch::default();
        for s in 0..5 {
            assert_eq!(watch.see(true, at(s)), None, "segundo {s}");
        }
        assert_eq!(watch.see(true, at(5)), Some(true));
        assert_eq!(watch.see(true, at(6)), None);
        assert_eq!(watch.see(true, at(60)), None);
        // Voltou a imagem: desfaz o aviso, uma vez.
        assert_eq!(watch.see(false, at(61)), Some(false));
        assert_eq!(watch.see(false, at(62)), None);
    }

    #[test]
    fn uma_imagem_no_meio_recomeca_a_conta() {
        let start = Instant::now();
        let at = |s: u64| start + Duration::from_secs(s);
        let mut watch = BlackWatch::default();
        for s in 0..4 {
            watch.see(true, at(s));
        }
        assert_eq!(watch.see(false, at(4)), None);
        for s in 5..10 {
            assert_eq!(watch.see(true, at(s)), None, "segundo {s}");
        }
        assert_eq!(watch.see(true, at(10)), Some(true));
    }
}
