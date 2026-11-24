//! A ordem dos encoders da placa e o que o app lembra dela (plano `v0.8-amf.md`, decisão 3).
//!
//! A ordem normal é o Media Foundation e, numa AMD em que ele não passe no teste, o AMF direto.
//! O teste custa 1,5 s quando o Media Foundation trava, então o app lembra, por placa e versão do
//! driver, onde ele travou e o AMF funcionou: dali em diante essa placa começa pelo AMF. Um
//! driver novo é outra chave, e testa tudo de novo.
//!
//! O app só lembra o caso "o Media Foundation trava e o AMF funciona". Uma falha passageira (outro
//! programa usando o encoder, por exemplo) nunca prende a placa no plano B.
//!
//! A memória é um arquivo JSON pequeno na pasta de dados do app, com a lista das placas.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use super::video::EncoderPreference;

/// Um caminho até o encoder da placa.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HardwarePath {
    /// O Media Foundation, com a textura na GPU.
    MediaFoundation,
    /// O AMF, direto com a biblioteca da AMD (só numa placa AMD).
    Amf,
}

/// Os caminhos a tentar, em ordem; se nenhum passar no teste, o plano B.
pub fn order(preference: EncoderPreference, amd: bool, mf_stalls_here: bool) -> Vec<HardwarePath> {
    use HardwarePath::{Amf, MediaFoundation};
    match preference {
        EncoderPreference::Auto if !amd => vec![MediaFoundation],
        EncoderPreference::Auto if mf_stalls_here => vec![Amf, MediaFoundation],
        EncoderPreference::Auto => vec![MediaFoundation, Amf],
        EncoderPreference::MediaFoundation => vec![MediaFoundation],
        EncoderPreference::Amf if amd => vec![Amf],
        EncoderPreference::Amf | EncoderPreference::Software => Vec::new(),
    }
}

/// O nome do arquivo, na pasta de dados do app.
const FILE: &str = "encoder-da-placa.json";

/// A pasta de dados do app, dada pelo `lib.rs` ao abrir (o vídeo não tem o `AppHandle`).
static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn set_data_dir(dir: PathBuf) {
    let _ = DATA_DIR.set(dir);
}

/// As placas (nome e driver) em que o Media Foundation trava e o AMF funciona.
#[derive(Debug, Default)]
pub struct EncoderMemory {
    path: Option<PathBuf>,
    mf_stalls: BTreeSet<String>,
}

impl EncoderMemory {
    /// A memória do app, ou uma vazia (que não grava) se a pasta não foi dada.
    pub fn open() -> Self {
        match DATA_DIR.get() {
            Some(dir) => Self::load(&dir.join(FILE)),
            None => Self::default(),
        }
    }

    /// Lê o arquivo; sem ele, ou com ele estragado, começa vazia.
    pub fn load(path: &Path) -> Self {
        let mf_stalls = std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            path: Some(path.to_path_buf()),
            mf_stalls,
        }
    }

    /// Se o Media Foundation travou nesta placa com este driver (e o AMF funcionou).
    pub fn mf_stalls(&self, adapter: &str, driver: &str) -> bool {
        self.mf_stalls.contains(&key(adapter, driver))
    }

    /// Guarda o resultado de uma abertura: `true` se o Media Foundation travou e o AMF
    /// funcionou, `false` se o Media Foundation funcionou. Grava só se mudou.
    pub fn remember(&mut self, adapter: &str, driver: &str, mf_stalls: bool) {
        let key = key(adapter, driver);
        let changed = if mf_stalls {
            self.mf_stalls.insert(key)
        } else {
            self.mf_stalls.remove(&key)
        };
        if changed {
            self.save();
        }
    }

    fn save(&self) {
        let Some(path) = &self.path else {
            return;
        };
        let result = path
            .parent()
            .map_or(Ok(()), std::fs::create_dir_all)
            .and_then(|()| {
                let json = serde_json::to_vec_pretty(&self.mf_stalls).unwrap_or_default();
                std::fs::write(path, json)
            });
        if let Err(error) = result {
            tracing::warn!(target: "media", %error, "não deu para gravar a memória do encoder");
        }
    }
}

fn key(adapter: &str, driver: &str) -> String {
    format!("{adapter} | {driver}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use HardwarePath::{Amf, MediaFoundation};

    #[test]
    fn a_ordem_normal_so_tenta_o_amf_numa_amd() {
        let auto = EncoderPreference::Auto;
        assert_eq!(order(auto, false, false), vec![MediaFoundation]);
        assert_eq!(order(auto, false, true), vec![MediaFoundation]);
        assert_eq!(order(auto, true, false), vec![MediaFoundation, Amf]);
        assert_eq!(order(auto, true, true), vec![Amf, MediaFoundation]);
    }

    #[test]
    fn o_ambiente_forca_um_caminho() {
        assert_eq!(
            order(EncoderPreference::MediaFoundation, true, true),
            vec![MediaFoundation]
        );
        assert_eq!(order(EncoderPreference::Amf, true, false), vec![Amf]);
        assert_eq!(order(EncoderPreference::Amf, false, false), vec![]);
        assert_eq!(order(EncoderPreference::Software, true, false), vec![]);
    }

    #[test]
    fn lembra_por_placa_e_driver_e_grava_no_arquivo() {
        let dir =
            std::env::temp_dir().join(format!("ashtar-encoder-memory-{}", std::process::id()));
        let path = dir.join(FILE);
        let _ = std::fs::remove_file(&path);

        let mut memory = EncoderMemory::load(&path);
        assert!(!memory.mf_stalls("RX 7600", "31.0.1"));
        memory.remember("RX 7600", "31.0.1", true);

        let memory = EncoderMemory::load(&path);
        assert!(memory.mf_stalls("RX 7600", "31.0.1"));
        assert!(
            !memory.mf_stalls("RX 7600", "32.0.0"),
            "driver novo testa de novo"
        );

        let mut memory = memory;
        memory.remember("RX 7600", "31.0.1", false);
        assert!(!EncoderMemory::load(&path).mf_stalls("RX 7600", "31.0.1"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn arquivo_estragado_comeca_vazio() {
        let dir =
            std::env::temp_dir().join(format!("ashtar-encoder-broken-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE);
        std::fs::write(&path, b"{ nao e json").unwrap();
        assert!(!EncoderMemory::load(&path).mf_stalls("x", "y"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
