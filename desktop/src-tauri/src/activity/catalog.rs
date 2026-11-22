//! De um caminho de `.exe` para um jogo (ADR 0033, decisão 2): os jogos adicionados à mão, os
//! launchers do PC e a lista do Discord, nessa ordem, com as correções do `games-extra.json`.
//!
//! Tudo aqui é lógica pura, sem Windows: os caminhos chegam como texto e são comparados sem
//! diferença de maiúsculas e com `/`.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// De onde veio o reconhecimento.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    Manual,
    Steam,
    Epic,
    Gog,
    Installed,
    Discord,
}

/// Um jogo de uma pasta de instalação, lido de um launcher.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstalledGame {
    /// A pasta, já normalizada ([`normalize`]), sem a `/` do fim.
    pub dir: String,
    pub name: String,
    pub source: Source,
    /// O id do jogo na Steam, para o ícone guardado por ela.
    pub steam_app_id: Option<String>,
}

/// Um jogo da lista do Discord: o fim do caminho do `.exe` (`javaw.exe`, `bin/game.exe`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DetectableGame {
    pub exe: String,
    pub name: String,
}

/// Um jogo adicionado à mão: o caminho inteiro do `.exe` e o nome que a pessoa deu.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManualGame {
    pub exe: String,
    pub name: String,
}

/// O jogo reconhecido num `.exe`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Recognized {
    /// Estável entre aberturas: o hash do caminho normalizado do `.exe`.
    pub id: String,
    pub name: String,
    /// O caminho do `.exe`, como o Windows deu.
    pub exe: String,
    pub source: Source,
    #[serde(skip)]
    pub steam_app_id: Option<String>,
}

/// As correções do `games-extra.json`.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Extra {
    /// Nomes de `.exe` que nunca são jogo (launchers, ajudantes, instaladores).
    #[serde(default)]
    pub not_games: Vec<String>,
    /// Nome de `.exe` → nome melhor.
    #[serde(default)]
    pub names: HashMap<String, String>,
}

impl Extra {
    /// As correções que vão dentro do app.
    pub fn bundled() -> Self {
        serde_json::from_str(include_str!("games-extra.json")).unwrap_or_default()
    }
}

/// `C:\Games\Foo\Bar.EXE` → `c:/games/foo/bar.exe`.
pub fn normalize(path: &str) -> String {
    path.trim()
        .trim_end_matches(['\\', '/'])
        .replace('\\', "/")
        .to_lowercase()
}

/// O id de um `.exe`.
pub fn game_id(exe: &str) -> String {
    let digest = Sha256::digest(normalize(exe).as_bytes());
    hex(&digest[..8])
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn file_name(normalized: &str) -> &str {
    normalized.rsplit('/').next().unwrap_or(normalized)
}

/// As fontes juntas, prontas para consultar.
#[derive(Debug, Default)]
pub struct Catalog {
    manual: HashMap<String, String>,
    /// Ordenadas da pasta mais comprida para a mais curta: a mais funda ganha.
    installed: Vec<InstalledGame>,
    /// Pelo nome do arquivo, para achar rápido; cada um com o fim do caminho que o Discord deu.
    detectable: HashMap<String, Vec<DetectableGame>>,
    not_games: HashSet<String>,
    names: HashMap<String, String>,
}

impl Catalog {
    pub fn new(
        manual: &[ManualGame],
        mut installed: Vec<InstalledGame>,
        detectable: &[DetectableGame],
        extra: &Extra,
    ) -> Self {
        installed.retain(|game| !game.dir.is_empty() && !game.name.trim().is_empty());
        installed.sort_by_key(|game| std::cmp::Reverse(game.dir.len()));
        let mut by_file: HashMap<String, Vec<DetectableGame>> = HashMap::new();
        for game in detectable {
            let exe = normalize(game.exe.trim_start_matches('>'));
            by_file
                .entry(file_name(&exe).to_owned())
                .or_default()
                .push(DetectableGame {
                    exe,
                    name: game.name.clone(),
                });
        }
        Self {
            manual: manual
                .iter()
                .map(|game| (normalize(&game.exe), game.name.clone()))
                .collect(),
            installed,
            detectable: by_file,
            not_games: extra
                .not_games
                .iter()
                .map(|exe| exe.to_lowercase())
                .collect(),
            names: extra
                .names
                .iter()
                .map(|(exe, name)| (exe.to_lowercase(), name.clone()))
                .collect(),
        }
    }

    /// O jogo do `.exe` em `exe_path`, ou `None` se não é jogo.
    pub fn recognize(&self, exe_path: &str) -> Option<Recognized> {
        let path = normalize(exe_path);
        let file = file_name(&path);
        let found = |name: &str, source, steam_app_id| Recognized {
            id: game_id(exe_path),
            name: self
                .names
                .get(file)
                .cloned()
                .unwrap_or_else(|| name.to_owned()),
            exe: exe_path.to_owned(),
            source,
            steam_app_id,
        };
        // O que a pessoa adicionou ganha de tudo, até das correções.
        if let Some(name) = self.manual.get(&path) {
            return Some(Recognized {
                id: game_id(exe_path),
                name: name.clone(),
                exe: exe_path.to_owned(),
                source: Source::Manual,
                steam_app_id: None,
            });
        }
        if self.not_games.contains(file) {
            return None;
        }
        if let Some(game) = self
            .installed
            .iter()
            .find(|game| path.starts_with(&format!("{}/", game.dir)))
        {
            return Some(found(&game.name, game.source, game.steam_app_id.clone()));
        }
        let candidates = self.detectable.get(file)?;
        candidates
            .iter()
            .find(|game| path == game.exe || path.ends_with(&format!("/{}", game.exe)))
            .map(|game| found(&game.name, Source::Discord, None))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn installed(dir: &str, name: &str, source: Source) -> InstalledGame {
        InstalledGame {
            dir: normalize(dir),
            name: name.into(),
            source,
            steam_app_id: None,
        }
    }

    fn detectable(exe: &str, name: &str) -> DetectableGame {
        DetectableGame {
            exe: exe.into(),
            name: name.into(),
        }
    }

    fn catalog() -> Catalog {
        Catalog::new(
            &[ManualGame {
                exe: r"D:\Jogos\Meu\jogo.exe".into(),
                name: "Meu jogo".into(),
            }],
            vec![
                installed(r"C:\Steam\steamapps\common\Hades", "Hades", Source::Steam),
                installed(r"C:\Epic\Fortnite", "Fortnite", Source::Epic),
                // A pasta mais funda ganha da mais rasa.
                installed(r"C:\Epic", "Epic inteiro", Source::Epic),
            ],
            &[
                detectable("javaw.exe", "Minecraft"),
                detectable("bin/cs2.exe", "Counter-Strike 2"),
                detectable(">valorant.exe", "VALORANT"),
                detectable("jogo.exe", "Outro jogo"),
            ],
            &Extra {
                not_games: vec!["EpicGamesLauncher.exe".into()],
                names: HashMap::from([("hades.exe".into(), "Hades I".into())]),
            },
        )
    }

    #[test]
    fn a_ordem_das_fontes() {
        let catalog = catalog();
        let name = |path: &str| catalog.recognize(path).map(|game| (game.name, game.source));
        // À mão ganha do Discord, mesmo com o mesmo nome de arquivo.
        assert_eq!(
            name(r"d:\JOGOS\meu\JOGO.EXE"),
            Some(("Meu jogo".into(), Source::Manual))
        );
        // O launcher, com a correção do nome.
        assert_eq!(
            name(r"C:\Steam\steamapps\common\Hades\x64\Hades.exe"),
            Some(("Hades I".into(), Source::Steam))
        );
        assert_eq!(
            name(r"C:\Epic\Fortnite\Bin\FortniteClient.exe"),
            Some(("Fortnite".into(), Source::Epic))
        );
        // O que não é jogo nunca é, nem dentro da pasta de um launcher.
        assert_eq!(name(r"C:\Epic\Launcher\EpicGamesLauncher.exe"), None);
        // O Discord pelo fim do caminho.
        assert_eq!(
            name(r"C:\Program Files\Java\bin\javaw.exe"),
            Some(("Minecraft".into(), Source::Discord))
        );
        assert_eq!(
            name(r"E:\CS\game\bin\cs2.exe"),
            Some(("Counter-Strike 2".into(), Source::Discord))
        );
        assert_eq!(name(r"E:\CS\cs2.exe"), None);
        assert_eq!(
            name(r"C:\Riot\VALORANT.exe"),
            Some(("VALORANT".into(), Source::Discord))
        );
        // Uma pasta com o mesmo começo não conta.
        assert_eq!(name(r"C:\Steam\steamapps\common\Hades2\h.exe"), None);
        assert_eq!(name(r"C:\Windows\notepad.exe"), None);
    }

    #[test]
    fn o_id_nao_depende_de_maiusculas_nem_da_barra() {
        assert_eq!(game_id(r"C:\Jogo\A.exe"), game_id("c:/jogo/a.EXE"));
        assert_ne!(game_id(r"C:\Jogo\A.exe"), game_id(r"C:\Jogo\B.exe"));
        assert_eq!(game_id("x").len(), 16);
    }

    #[test]
    fn as_correcoes_de_dentro_do_app_abrem() {
        let extra = Extra::bundled();
        assert!(extra.not_games.iter().any(|exe| exe == "steam.exe"));
    }
}
