//! Os presets da transmissão (ADR 0018).
//!
//! O frontend manda só o nome (`"1080p60"`). Aqui ele vira o formato do vídeo: a caixa máxima, o
//! fps e o bitrate. A imagem é reduzida para caber na caixa, nunca ampliada. Os textos do seletor
//! ficam no `presets.ts`, com as mesmas chaves.

use serde::Deserialize;

use super::video::VideoFormat;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum Quality {
    /// Leve: 1280×720 a 60 fps, para upload fraco ou placa de vídeo antiga.
    #[serde(rename = "720p60")]
    Light,
    /// Movimento: 1920×1080 a 60 fps, para jogos e vídeos.
    #[serde(rename = "1080p60")]
    Motion,
    /// Nitidez: 1920×1080 a 30 fps, com mais bits por frame, para texto.
    #[serde(rename = "1080p30")]
    Detail,
}

impl Quality {
    #[cfg(test)]
    pub const ALL: [Quality; 3] = [Self::Light, Self::Motion, Self::Detail];

    /// O que o preset pede ao vídeo. Os bitrates são o ponto de partida; a medição da Etapa 6 da
    /// v0.2.4 escolhe os definitivos.
    pub const fn format(self) -> VideoFormat {
        match self {
            Self::Light => VideoFormat {
                max_width: 1280,
                max_height: 720,
                fps: 60,
                bitrate_bps: 4_000_000,
            },
            Self::Motion => VideoFormat {
                max_width: 1920,
                max_height: 1080,
                fps: 60,
                bitrate_bps: 8_000_000,
            },
            Self::Detail => VideoFormat {
                max_width: 1920,
                max_height: 1080,
                fps: 30,
                bitrate_bps: 6_000_000,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::publisher::MAX_BITRATE_BPS;

    #[test]
    fn le_os_nomes_enviados_pelo_frontend() {
        let q: Quality = serde_json::from_str(r#""720p60""#).unwrap();
        assert_eq!(q, Quality::Light);
        let q: Quality = serde_json::from_str(r#""1080p60""#).unwrap();
        assert_eq!(q, Quality::Motion);
        let q: Quality = serde_json::from_str(r#""1080p30""#).unwrap();
        assert_eq!(q, Quality::Detail);

        // O Equilibrado do caminho IPC saiu.
        assert!(serde_json::from_str::<Quality>(r#""900p60""#).is_err());
    }

    #[test]
    fn todo_preset_e_um_formato_valido_dentro_do_teto() {
        for q in Quality::ALL {
            let format = q.format();
            assert!(format.validate().is_ok(), "{q:?}");
            assert!(
                format.max_width % 2 == 0 && format.max_height % 2 == 0,
                "{q:?}"
            );
            // A trilha anuncia o teto: um preset acima dele nunca chegaria ao bitrate.
            assert!(format.bitrate_bps <= MAX_BITRATE_BPS, "{q:?}");
        }
    }

    #[test]
    fn leve_gasta_menos_que_movimento() {
        assert!(Quality::Light.format().bitrate_bps < Quality::Motion.format().bitrate_bps);
    }

    #[test]
    fn nitidez_tem_mais_bits_por_frame() {
        let per_frame = |q: Quality| q.format().bitrate_bps / q.format().fps;
        assert!(per_frame(Quality::Detail) > per_frame(Quality::Motion));
    }
}
