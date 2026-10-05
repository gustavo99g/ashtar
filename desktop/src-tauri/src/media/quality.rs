//! Presets de qualidade do compartilhamento (decisão 16 do `PLAN.md`).
//!
//! O frontend manda só o nome (`"720p60"`). Aqui ele vira o que o Rust
//! precisa: a caixa máxima e o fps da captura, e quantos frames podem estar
//! em trânsito no caminho IPC. Bitrate e dicas ao encoder são do frontend,
//! que é quem publica a trilha.

use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum Quality {
    /// Movimento: 1280×720 a 60 fps.
    #[serde(rename = "720p60")]
    Motion,
    /// Equilibrado: 1600×900 a 60 fps.
    #[serde(rename = "900p60")]
    Balanced,
    /// Nitidez: 1920×1080 a 30 fps.
    #[serde(rename = "1080p30")]
    Detail,
}

/// O que um preset significa para o Rust.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QualityPreset {
    pub max_width: u32,
    pub max_height: u32,
    pub fps: u32,
    /// Máximo de frames em trânsito no caminho IPC (limite do `FrameGate`).
    pub max_in_flight: u32,
}

impl Quality {
    pub const ALL: [Quality; 3] = [Self::Motion, Self::Balanced, Self::Detail];

    pub const fn preset(self) -> QualityPreset {
        match self {
            Self::Motion => QualityPreset {
                max_width: 1280,
                max_height: 720,
                fps: 60,
                max_in_flight: 5,
            },
            Self::Balanced => QualityPreset {
                max_width: 1600,
                max_height: 900,
                fps: 60,
                max_in_flight: 5,
            },
            Self::Detail => QualityPreset {
                max_width: 1920,
                max_height: 1080,
                fps: 30,
                max_in_flight: 3,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ida e volta de um frame medida em dev (decisão 16): ~70 ms.
    const MEASURED_ROUND_TRIP_S: f64 = 0.070;

    #[test]
    fn le_os_nomes_enviados_pelo_frontend() {
        let q: Quality = serde_json::from_str(r#""720p60""#).unwrap();
        assert_eq!(q, Quality::Motion);
        let q: Quality = serde_json::from_str(r#""900p60""#).unwrap();
        assert_eq!(q, Quality::Balanced);
        let q: Quality = serde_json::from_str(r#""1080p30""#).unwrap();
        assert_eq!(q, Quality::Detail);

        assert!(serde_json::from_str::<Quality>(r#""1080p60""#).is_err());
    }

    #[test]
    fn caixas_tem_dimensoes_pares() {
        for q in Quality::ALL {
            let p = q.preset();
            assert!(p.max_width % 2 == 0 && p.max_height % 2 == 0, "{q:?}");
        }
    }

    #[test]
    fn gate_nao_limita_o_fps_do_preset() {
        // Com N frames em trânsito, o fps máximo é N / ida e volta.
        for q in Quality::ALL {
            let p = q.preset();
            let max_fps = p.max_in_flight as f64 / MEASURED_ROUND_TRIP_S;
            assert!(
                max_fps >= p.fps as f64,
                "{q:?}: {} em trânsito dá no máximo {max_fps:.0} fps",
                p.max_in_flight
            );
        }
    }
}
