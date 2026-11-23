//! A lista de jogos detectáveis (ADR 0033, decisão 2 do plano da v0.8): o par "nome do `.exe` →
//! nome do jogo" da lista pública do Discord, para o app reconhecer o que os launchers do PC não
//! conhecem.
//!
//! Quem busca é a API, uma vez por dia, para o IP de ninguém do grupo ir ao Discord. A cópia boa
//! fica num arquivo da pasta de dados e na memória; uma resposta quebrada, vazia ou fora do ar não
//! apaga a cópia. O app pede por `GET /api/games/detectable`, com `ETag`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use ts_rs::TS;

/// A lista pública do Discord (sem login).
pub const DISCORD_DETECTABLE_URL: &str = "https://discord.com/api/v9/applications/detectable";

/// De quanto em quanto tempo a API busca de novo.
pub const REFRESH_EVERY: Duration = Duration::from_secs(24 * 60 * 60);

/// Tempo máximo da busca: a lista tem alguns MB.
const TIMEOUT: Duration = Duration::from_secs(60);

/// Uma lista com menos que isto é tratada como quebrada (a de verdade tem milhares).
const MIN_GAMES: usize = 100;

/// Um jogo da lista, como o app recebe.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct DetectableGame {
    /// O fim do caminho do `.exe`, em minúsculas e com `/` (`javaw.exe`, `bin/game.exe`).
    pub exe: String,
    pub name: String,
}

/// A cópia de agora: a lista em JSON, pronta para mandar, e o `ETag` dela.
#[derive(Debug, Clone)]
struct Copy {
    json: String,
    etag: String,
}

/// A lista guardada pela API.
pub struct DetectableGames {
    file: PathBuf,
    copy: RwLock<Option<Copy>>,
}

impl DetectableGames {
    /// Abre a cópia de `data_dir/detectable-games.json`, se existir.
    pub fn open(data_dir: &Path) -> Self {
        let file = data_dir.join("detectable-games.json");
        let copy = std::fs::read_to_string(&file)
            .ok()
            .filter(|json| serde_json::from_str::<Vec<DetectableGame>>(json).is_ok())
            .map(|json| Copy {
                etag: etag_of(&json),
                json,
            });
        Self {
            file,
            copy: RwLock::new(copy),
        }
    }

    /// A lista em JSON e o `ETag`, ou `None` antes da primeira busca boa.
    pub fn current(&self) -> Option<(String, String)> {
        self.copy
            .read()
            .unwrap()
            .as_ref()
            .map(|copy| (copy.json.clone(), copy.etag.clone()))
    }

    /// Troca a cópia pela resposta do Discord, se ela serve. Devolve quantos jogos ficaram, ou o
    /// motivo de ter mantido a cópia antiga.
    pub fn replace_from(&self, discord_json: &str) -> Result<usize, String> {
        let games = parse_discord(discord_json)?;
        if games.len() < MIN_GAMES {
            return Err(format!("só {} jogos: parece quebrada", games.len()));
        }
        let json = serde_json::to_string(&games).map_err(|error| error.to_string())?;
        if let Some(dir) = self.file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let partial = self.file.with_extension("json.part");
        std::fs::write(&partial, &json)
            .and_then(|()| std::fs::rename(&partial, &self.file))
            .map_err(|error| format!("não deu para gravar: {error}"))?;
        *self.copy.write().unwrap() = Some(Copy {
            etag: etag_of(&json),
            json,
        });
        Ok(games.len())
    }

    /// Busca a lista no Discord e troca a cópia. Um erro vai para o log e a cópia fica.
    pub async fn refresh(&self) {
        let result = async {
            let client = reqwest::Client::builder()
                .timeout(TIMEOUT)
                .build()
                .map_err(|error| error.to_string())?;
            let body = client
                .get(DISCORD_DETECTABLE_URL)
                .header("user-agent", "Ashtar")
                .send()
                .await
                .and_then(|response| response.error_for_status())
                .map_err(|error| error.to_string())?
                .text()
                .await
                .map_err(|error| error.to_string())?;
            self.replace_from(&body)
        }
        .await;
        match result {
            Ok(count) => println!("Jogos detectáveis: {count}"),
            Err(error) => eprintln!("jogos detectáveis: mantive a cópia anterior: {error}"),
        }
    }
}

fn etag_of(json: &str) -> String {
    let digest = Sha256::digest(json.as_bytes());
    format!("\"{}\"", hex::encode(&digest[..16]))
}

#[derive(Deserialize)]
struct DiscordApp {
    name: String,
    #[serde(default)]
    executables: Vec<DiscordExe>,
}

#[derive(Deserialize)]
struct DiscordExe {
    name: String,
    #[serde(default)]
    os: String,
    #[serde(default)]
    is_launcher: bool,
}

/// Da lista do Discord para os pares que o app usa: só os `.exe` do Windows, sem os launchers,
/// em minúsculas, com `/` e sem o `>` do começo (que o Discord usa para "só este nome"). Um mesmo
/// `.exe` em dois jogos fica com o primeiro, e a lista sai em ordem.
pub fn parse_discord(json: &str) -> Result<Vec<DetectableGame>, String> {
    let apps: Vec<DiscordApp> =
        serde_json::from_str(json).map_err(|error| format!("formato inesperado: {error}"))?;
    let mut games = BTreeMap::new();
    for app in apps {
        let name = app.name.trim();
        if name.is_empty() {
            continue;
        }
        for exe in app.executables {
            if exe.os != "win32" || exe.is_launcher {
                continue;
            }
            let path = exe
                .name
                .trim()
                .trim_start_matches('>')
                .replace('\\', "/")
                .to_lowercase();
            if !path.ends_with(".exe") || path.len() > 200 {
                continue;
            }
            games.entry(path).or_insert_with(|| name.to_owned());
        }
    }
    Ok(games
        .into_iter()
        .map(|(exe, name)| DetectableGame { exe, name })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"[
        {"id":"1","name":"Minecraft","executables":[
            {"name":"javaw.exe","os":"win32","is_launcher":false},
            {"name":"minecraft","os":"darwin"}]},
        {"id":"2","name":"Counter-Strike 2","executables":[
            {"name":">cs2.exe","os":"win32"},
            {"name":"Game\\Bin\\CS2.EXE","os":"win32"}]},
        {"id":"3","name":"Battle.net","executables":[
            {"name":"battle.net.exe","os":"win32","is_launcher":true}]},
        {"id":"4","name":"Outro Minecraft","executables":[
            {"name":"javaw.exe","os":"win32"}]},
        {"id":"5","name":"  ","executables":[{"name":"vazio.exe","os":"win32"}]}
    ]"#;

    #[test]
    fn fica_so_o_exe_do_windows_sem_launcher() {
        let games = parse_discord(SAMPLE).unwrap();
        let pairs: Vec<(&str, &str)> = games
            .iter()
            .map(|game| (game.exe.as_str(), game.name.as_str()))
            .collect();
        assert_eq!(
            pairs,
            [
                ("cs2.exe", "Counter-Strike 2"),
                ("game/bin/cs2.exe", "Counter-Strike 2"),
                ("javaw.exe", "Minecraft"),
            ]
        );
    }

    fn many(n: usize) -> String {
        let apps: Vec<String> = (0..n)
            .map(|i| {
                format!(
                    r#"{{"name":"Jogo {i}","executables":[{{"name":"jogo{i}.exe","os":"win32"}}]}}"#
                )
            })
            .collect();
        format!("[{}]", apps.join(","))
    }

    #[test]
    fn resposta_quebrada_nao_apaga_a_copia_boa() {
        let dir = std::env::temp_dir().join(format!("ashtar-jogos-{}", uuid::Uuid::new_v4()));
        let games = DetectableGames::open(&dir);
        assert!(games.current().is_none());
        assert_eq!(games.replace_from(&many(150)).unwrap(), 150);
        let (json, etag) = games.current().unwrap();

        // Fora do formato, curta demais ou vazia: a cópia continua.
        assert!(games.replace_from("<html>erro</html>").is_err());
        assert!(games.replace_from(&many(3)).is_err());
        assert!(games.replace_from("[]").is_err());
        assert_eq!(games.current().unwrap(), (json.clone(), etag.clone()));

        // E volta do arquivo ao reabrir, com o mesmo ETag.
        let reopened = DetectableGames::open(&dir);
        assert_eq!(reopened.current().unwrap(), (json, etag));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
