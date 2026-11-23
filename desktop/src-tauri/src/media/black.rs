//! O aviso "Sua transmissão está saindo preta" (decisão 26 do plano da v0.8): um filme com
//! proteção (DRM) ou um jogo em tela cheia exclusiva sai todo preto na captura, e quem transmite
//! não percebe. A miniatura da própria fonte é conferida uma vez por segundo; 5 segundos seguidos
//! de imagem toda preta viram o aviso, e a primeira imagem com conteúdo o desfaz.
//!
//! "Saindo preta" é a maior parte da imagem preta de verdade (o zero da proteção, com o ruído do
//! JPEG), mesmo com a legenda, os controles do player ou a barra do navegador por cima. Uma cena
//! escura de jogo ou de filme quase nunca é zero: tem um cinza bem escuro, a interface, uma luz.

use std::time::{Duration, Instant};

/// Quanto tempo de preto até avisar.
pub const BLACK_FOR: Duration = Duration::from_secs(5);
/// De quanto em quanto tempo uma miniatura é conferida.
pub const CHECK_EVERY: Duration = Duration::from_secs(1);

/// O brilho (0 a 255) até onde um pixel é preto de verdade: o zero mais o ruído do JPEG.
const NEAR_BLACK: u8 = 10;
/// A parte da imagem que precisa ser preta de verdade. O resto pode ser a legenda, os controles
/// do player, a barra de título ou a do navegador.
const BLACK_SHARE: f64 = 0.75;

/// Se a imagem (RGB, 3 bytes por pixel) está saindo preta.
pub fn looks_black(rgb: &[u8]) -> bool {
    let (pixels, _) = rgb.as_chunks::<3>();
    if pixels.is_empty() {
        return false;
    }
    let black = pixels
        .iter()
        .filter(|&&[r, g, b]| {
            // O brilho como o olho vê (BT.601), em inteiros.
            let luma = (299 * u32::from(r) + 587 * u32::from(g) + 114 * u32::from(b)) / 1000;
            luma <= u32::from(NEAR_BLACK)
        })
        .count();
    black as f64 / pixels.len() as f64 >= BLACK_SHARE
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
        // O filme protegido com a legenda e os controles do player por cima: ainda preto.
        let mut player = image([0, 0, 0], 80);
        player.extend(image([230, 230, 230], 8));
        player.extend(image([40, 40, 40], 12));
        assert!(looks_black(&player));
        // Uma cena escura de jogo: cinza bem escuro, não zero, e a interface.
        let mut scene = image([14, 14, 18], 90);
        scene.extend(image([200, 200, 200], 10));
        assert!(!looks_black(&scene));
        // Meio a meio: tem imagem.
        let mut half = image([0, 0, 0], 50);
        half.extend(image([120, 90, 60], 50));
        assert!(!looks_black(&half));
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
