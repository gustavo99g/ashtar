//! Os jogos instalados pelos launchers do PC (ADR 0033, decisão 2): a pasta de cada um e o nome
//! que o launcher dá. Nada sai do PC.
//!
//! - **Steam**: as bibliotecas do `libraryfolders.vdf` e os `appmanifest_*.acf` de cada uma.
//! - **Epic**: os manifestos `.item` em `ProgramData`.
//! - **Os outros** (EA, Ubisoft, Riot, Battle.net e GOG): a lista de programas instalados do
//!   Windows (a mesma do "Adicionar ou remover programas"), filtrada pela editora.
//!
//! Cada leitor é separado: um arquivo que mudou de formato ou está corrompido é ignorado, com uma
//! linha no log, e os outros continuam valendo.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use tracing::warn;

use super::catalog::{normalize, InstalledGame, Source};

/// Um programa da lista de instalados do Windows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstalledProgram {
    pub name: String,
    pub location: String,
    pub publisher: String,
}

/// As editoras cujos programas instalados são jogos (os launchers delas ficam de fora pelo
/// `games-extra.json` e pelo nome).
const GAME_PUBLISHERS: [&str; 7] = [
    "electronic arts",
    "ubisoft",
    "riot games",
    "blizzard entertainment",
    "gog.com",
    "gog sp. z o.o.",
    "cd projekt red",
];

/// Os nomes dos próprios launchers, na lista de instalados e na do Discord.
const LAUNCHER_NAMES: [&str; 9] = [
    "ea app",
    "origin",
    "ubisoft connect",
    "riot client",
    "riot vanguard",
    "battle.net",
    "gog galaxy",
    "epic games launcher",
    "steam",
];

/// Todos os jogos que os launchers conhecem.
pub fn scan(steam_root: Option<PathBuf>, programs: &[InstalledProgram]) -> Vec<InstalledGame> {
    let mut games = Vec::new();
    if let Some(root) = steam_root {
        games.extend(steam_games(&root));
    }
    games.extend(epic_games(Path::new(
        r"C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests",
    )));
    games.extend(installed_games(programs));
    games
}

/// Os pares `"chave" "valor"` de um arquivo VDF/ACF da Steam, na ordem, sem os blocos.
fn vdf_pairs(text: &str) -> Vec<(String, String)> {
    let mut tokens = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                let mut token = String::new();
                while let Some(c) = chars.next() {
                    match c {
                        '\\' => {
                            if let Some(next) = chars.next() {
                                token.push(next);
                            }
                        }
                        '"' => break,
                        c => token.push(c),
                    }
                }
                tokens.push(Some(token));
            }
            '{' | '}' => tokens.push(None),
            _ => {}
        }
    }
    let mut pairs = Vec::new();
    let mut i = 0;
    while i + 1 < tokens.len() {
        match (&tokens[i], &tokens[i + 1]) {
            (Some(key), Some(value)) => {
                pairs.push((key.to_lowercase(), value.clone()));
                i += 2;
            }
            _ => i += 1,
        }
    }
    pairs
}

/// As pastas das bibliotecas da Steam (`path` no `libraryfolders.vdf`), com a da própria Steam.
pub fn steam_libraries(root: &Path, libraryfolders: &str) -> Vec<PathBuf> {
    let mut libraries = vec![root.to_path_buf()];
    for (key, value) in vdf_pairs(libraryfolders) {
        if key == "path" {
            let path = PathBuf::from(value);
            if !libraries.contains(&path) {
                libraries.push(path);
            }
        }
    }
    libraries
}

/// Um `appmanifest_*.acf`: o id, o nome e a pasta dentro de `steamapps/common`.
pub fn steam_manifest(text: &str) -> Option<(String, String, String)> {
    let pairs = vdf_pairs(text);
    let get = |name: &str| {
        pairs
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.trim().to_owned())
            .filter(|value| !value.is_empty())
    };
    Some((get("appid")?, get("name")?, get("installdir")?))
}

fn steam_games(root: &Path) -> Vec<InstalledGame> {
    let folders = root.join("steamapps").join("libraryfolders.vdf");
    let libraries = match std::fs::read_to_string(&folders) {
        Ok(text) => steam_libraries(root, &text),
        Err(_) => vec![root.to_path_buf()],
    };
    let mut games = Vec::new();
    for library in libraries {
        let apps = library.join("steamapps");
        let Ok(entries) = std::fs::read_dir(&apps) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let is_manifest = path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("appmanifest_") && name.ends_with(".acf"));
            if !is_manifest {
                continue;
            }
            let Some((app_id, name, dir)) = std::fs::read_to_string(&path)
                .ok()
                .and_then(|text| steam_manifest(&text))
            else {
                warn!(arquivo = %path.display(), "manifesto da Steam ignorado");
                continue;
            };
            // As ferramentas da Steam (o Proton, os redistribuíveis) não são jogos.
            if name.starts_with("Steamworks Common") || name.starts_with("Proton") {
                continue;
            }
            games.push(InstalledGame {
                dir: normalize(&apps.join("common").join(dir).to_string_lossy()),
                name,
                source: Source::Steam,
                steam_app_id: Some(app_id),
            });
        }
    }
    games
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct EpicManifest {
    display_name: String,
    install_location: String,
    #[serde(default)]
    app_categories: Vec<String>,
}

/// Um manifesto `.item` do Epic, se for de um jogo.
pub fn epic_manifest(text: &str) -> Option<InstalledGame> {
    let manifest: EpicManifest = serde_json::from_str(text).ok()?;
    let is_game = manifest.app_categories.is_empty()
        || manifest
            .app_categories
            .iter()
            .any(|category| category.eq_ignore_ascii_case("games"));
    (is_game && !manifest.install_location.trim().is_empty()).then(|| InstalledGame {
        dir: normalize(&manifest.install_location),
        name: manifest.display_name.trim().to_owned(),
        source: Source::Epic,
        steam_app_id: None,
    })
}

fn epic_games(dir: &Path) -> Vec<InstalledGame> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "item"))
        .filter_map(|path| {
            let game = std::fs::read_to_string(&path)
                .ok()
                .and_then(|text| epic_manifest(&text));
            if game.is_none() {
                warn!(arquivo = %path.display(), "manifesto do Epic ignorado");
            }
            game
        })
        .collect()
}

/// Se `name` é o de um launcher: igual, ou com um complemento entre parênteses ("Riot Client
/// (beta)"). "SteamWorld Dig" não é.
pub fn is_launcher_name(name: &str) -> bool {
    let name = name.trim().to_lowercase();
    LAUNCHER_NAMES
        .iter()
        .any(|launcher| name == *launcher || name.starts_with(&format!("{launcher} (")))
}

/// Os programas instalados que são jogos: das editoras de jogos, com a pasta, sem os launchers.
pub fn installed_games(programs: &[InstalledProgram]) -> Vec<InstalledGame> {
    programs
        .iter()
        .filter(|program| {
            let publisher = program.publisher.to_lowercase();
            GAME_PUBLISHERS
                .iter()
                .any(|known| publisher.starts_with(known))
        })
        .filter(|program| {
            let name = program.name.to_lowercase();
            !is_launcher_name(&name)
        })
        .filter(|program| !program.location.trim().is_empty() && !program.name.trim().is_empty())
        .map(|program| InstalledGame {
            dir: normalize(program.location.trim_matches('"')),
            name: program.name.trim().to_owned(),
            source: if program.publisher.to_lowercase().starts_with("gog") {
                Source::Gog
            } else {
                Source::Installed
            },
            steam_app_id: None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIBRARIES: &str = r#"
"libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"apps" { "228980" "123" }
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
	}
}"#;

    const MANIFEST: &str = r#"
"AppState"
{
	"appid"		"1145360"
	"Universe"		"1"
	"name"		"Hades"
	"StateFlags"		"4"
	"installdir"		"Hades"
	"UserConfig" { "language" "brazilian" }
}"#;

    #[test]
    fn le_as_bibliotecas_e_o_manifesto_da_steam() {
        let root = PathBuf::from(r"C:\Program Files (x86)\Steam");
        let libraries = steam_libraries(&root, LIBRARIES);
        assert_eq!(libraries, [root.clone(), PathBuf::from(r"D:\SteamLibrary")]);
        assert_eq!(
            steam_manifest(MANIFEST),
            Some(("1145360".into(), "Hades".into(), "Hades".into()))
        );
        // Corrompido ou cortado: ignorado.
        assert_eq!(steam_manifest(r#""AppState" { "appid" "1" "#), None);
        assert_eq!(steam_manifest("lixo"), None);
    }

    #[test]
    fn le_o_manifesto_do_epic() {
        let game = epic_manifest(
            r#"{"DisplayName":"Fortnite","InstallLocation":"C:\\Program Files\\Epic Games\\Fortnite",
                "AppCategories":["public","games","applications"]}"#,
        )
        .unwrap();
        assert_eq!(game.name, "Fortnite");
        assert_eq!(game.dir, "c:/program files/epic games/fortnite");
        // Um plugin do Unreal não é jogo; um manifesto quebrado é ignorado.
        assert!(epic_manifest(
            r#"{"DisplayName":"Plugin","InstallLocation":"C:\\x","AppCategories":["plugins"]}"#
        )
        .is_none());
        assert!(epic_manifest("{").is_none());
    }

    #[test]
    fn o_nome_do_launcher() {
        assert!(is_launcher_name("Riot Client"));
        assert!(is_launcher_name(" riot client (beta)"));
        assert!(is_launcher_name("Steam"));
        assert!(!is_launcher_name("SteamWorld Dig"));
        assert!(!is_launcher_name("League of Legends"));
    }

    #[test]
    fn dos_instalados_so_os_jogos_das_editoras() {
        let program = |name: &str, location: &str, publisher: &str| InstalledProgram {
            name: name.into(),
            location: location.into(),
            publisher: publisher.into(),
        };
        let games = installed_games(&[
            program(
                "VALORANT",
                r"C:\Riot Games\VALORANT\live",
                "Riot Games, Inc",
            ),
            program(
                "EA app",
                r"C:\Program Files\Electronic Arts\EA Desktop",
                "Electronic Arts",
            ),
            program("Battlefield 2042", r"C:\EA\BF2042", "Electronic Arts"),
            program("The Witcher 3", r#""D:\GOG\Witcher 3""#, "GOG.com"),
            program(
                "Riot Client",
                r"C:\Riot Games\Riot Client",
                "Riot Games, Inc",
            ),
            program(
                "Riot Vanguard",
                r"C:\Program Files\Riot Vanguard",
                "Riot Games, Inc.",
            ),
            program("Google Chrome", r"C:\Chrome", "Google LLC"),
            program("Sem pasta", "", "Ubisoft"),
        ]);
        let found: Vec<(&str, &str, Source)> = games
            .iter()
            .map(|game| (game.name.as_str(), game.dir.as_str(), game.source))
            .collect();
        assert_eq!(
            found,
            [
                ("VALORANT", "c:/riot games/valorant/live", Source::Installed),
                ("Battlefield 2042", "c:/ea/bf2042", Source::Installed),
                ("The Witcher 3", "d:/gog/witcher 3", Source::Gog),
            ]
        );
    }
}
