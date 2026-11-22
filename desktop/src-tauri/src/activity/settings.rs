//! O `activity.json` (ADR 0033, decisão 3): a chave geral, os jogos escondidos, os adicionados à
//! mão e os que já abriram neste PC. Fica no Rust, não no `localStorage`, porque o Rust precisa
//! dele antes de o WebView abrir. Um arquivo antigo ou corrompido volta ao padrão.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::catalog::{ManualGame, Source};

/// Quantos jogos reconhecidos a lista guarda (os mais recentes).
const SEEN_MAX: usize = 100;

/// Um jogo que já abriu neste PC.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SeenGame {
    pub id: String,
    pub name: String,
    pub exe: String,
    pub source: Source,
    /// A última vez que abriu, em milissegundos desde 1970.
    pub last_seen: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ActivitySettings {
    /// "Mostrar o jogo detectado". Desligada, a tarefa nem roda.
    pub enabled: bool,
    /// Os ids dos jogos com "Não mostrar para este jogo".
    pub hidden: Vec<String>,
    pub manual: Vec<ManualGame>,
    /// Do mais recente para o mais antigo.
    pub seen: Vec<SeenGame>,
}

impl Default for ActivitySettings {
    fn default() -> Self {
        Self {
            enabled: true,
            hidden: Vec::new(),
            manual: Vec::new(),
            seen: Vec::new(),
        }
    }
}

impl ActivitySettings {
    /// Lê o arquivo; sem ele, ou corrompido, o padrão.
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    /// Grava por um arquivo temporário, para uma queda no meio não deixar o arquivo pela metade.
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let partial = path.with_extension("json.part");
        std::fs::write(&partial, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(&partial, path)
    }

    pub fn is_hidden(&self, id: &str) -> bool {
        self.hidden.iter().any(|hidden| hidden == id)
    }

    pub fn set_hidden(&mut self, id: &str, hidden: bool) {
        self.hidden.retain(|known| known != id);
        if hidden {
            self.hidden.push(id.to_owned());
        }
    }

    /// Marca que `game` abriu agora, no topo da lista. Devolve se ele é novo na lista.
    pub fn saw(&mut self, game: SeenGame) -> bool {
        let before = self.seen.len();
        self.seen.retain(|known| known.id != game.id);
        let new = self.seen.len() == before;
        self.seen.insert(0, game);
        self.seen.truncate(SEEN_MAX);
        new
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seen(id: &str, at: i64) -> SeenGame {
        SeenGame {
            id: id.into(),
            name: id.into(),
            exe: format!(r"C:\{id}.exe"),
            source: Source::Steam,
            last_seen: at,
        }
    }

    #[test]
    fn arquivo_antigo_ou_corrompido_volta_ao_padrao() {
        let dir = std::env::temp_dir().join(format!("ashtar-atividade-{}", std::process::id()));
        let path = dir.join("activity.json");
        assert_eq!(ActivitySettings::load(&path), ActivitySettings::default());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, "{ quebrado").unwrap();
        assert!(ActivitySettings::load(&path).enabled);
        // Um arquivo de uma versão sem os campos novos completa com o padrão.
        std::fs::write(&path, r#"{"enabled": false}"#).unwrap();
        let old = ActivitySettings::load(&path);
        assert!(!old.enabled && old.seen.is_empty());

        let mut settings = ActivitySettings::default();
        settings.set_hidden("a", true);
        settings.save(&path).unwrap();
        assert!(ActivitySettings::load(&path).is_hidden("a"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_lista_dos_vistos_tem_o_mais_recente_em_cima() {
        let mut settings = ActivitySettings::default();
        assert!(settings.saw(seen("a", 1)));
        assert!(settings.saw(seen("b", 2)));
        assert!(!settings.saw(seen("a", 3)));
        let order: Vec<(&str, i64)> = settings
            .seen
            .iter()
            .map(|game| (game.id.as_str(), game.last_seen))
            .collect();
        assert_eq!(order, [("a", 3), ("b", 2)]);
        settings.set_hidden("b", true);
        settings.set_hidden("b", true);
        assert_eq!(settings.hidden, ["b"]);
        settings.set_hidden("b", false);
        assert!(settings.hidden.is_empty());
    }
}
