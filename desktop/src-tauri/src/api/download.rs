//! O Baixar dos arquivos do chat (ADR 0031): o Rust baixa direto para a pasta Downloads, em
//! pedaços, sem o arquivo inteiro passar pela memória do WebView. O token vem do JavaScript (é o
//! mesmo do `apiFetch`); o endereço é o da API do build, nunca um que o JavaScript escolhe.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;
use tracing::warn;

use super::{config, transport, ApiError};

/// Sem chegar nada nesse tempo, desiste (o arquivo inteiro pode levar minutos).
const READ_TIMEOUT: Duration = Duration::from_secs(30);
/// De quanto em quanto tempo o progresso vai para a tela.
const PROGRESS_EVERY: Duration = Duration::from_millis(200);

/// Quanto já chegou e o total (sem `Content-Length`, `None`).
#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct Progress {
    pub received: u64,
    pub total: Option<u64>,
}

fn client() -> Result<&'static reqwest::Client, ApiError> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(READ_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| ApiError::app(format!("não foi possível preparar o HTTP: {error}")))?;
    Ok(CLIENT.get_or_init(|| client))
}

/// O id de um arquivo: um UUID (letras, números e hífens).
fn valid_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// O nome que vai para o disco: sem pastas e sem os caracteres que o Windows recusa.
pub fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim();
    if cleaned.is_empty() {
        "arquivo".to_owned()
    } else {
        cleaned.chars().take(180).collect()
    }
}

/// Um caminho livre em `dir`: `nome.ext`, ou `nome (1).ext`, `nome (2).ext`...
pub fn free_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(dot) if dot > 0 => (&name[..dot], &name[dot..]),
        _ => (name, ""),
    };
    (1..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|path| !path.exists())
        .expect("sempre há um número livre")
}

/// De onde vem o que se baixa: um arquivo do chat (`/api/files/{id}`) ou os logs que alguém
/// mandou (`/api/logs/{id}`, no Painel).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    Files,
    Logs,
}

/// Baixa o arquivo `id` para `dir` com o nome `name` (ou o próximo livre) e devolve o caminho.
/// Enquanto baixa, grava em `<caminho>.part`; só no fim ganha o nome certo.
pub async fn download(
    source: Source,
    id: &str,
    name: &str,
    token: &str,
    version: &str,
    dir: &Path,
    mut on_progress: impl FnMut(Progress),
) -> Result<PathBuf, ApiError> {
    if !valid_id(id) {
        return Err(ApiError::app("O arquivo não é válido."));
    }
    let base =
        config::api_url().ok_or_else(|| ApiError::app("VITE_API_URL não está configurada."))?;
    let path = match source {
        Source::Files => format!("/api/files/{id}"),
        Source::Logs => format!("/api/logs/{id}"),
    };
    let response = client()?
        .get(format!("{base}{path}"))
        .header("X-App-Version", version)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| transport(&path, error))?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        let bytes = response.bytes().await.unwrap_or_default();
        let error = ApiError::from_response(status, &bytes);
        warn!(path, status, kind = %error.kind, "a API recusou o download");
        return Err(error);
    }
    let total = response.content_length();

    tokio::fs::create_dir_all(dir)
        .await
        .map_err(|error| ApiError::app(format!("Não deu para usar a pasta Downloads: {error}")))?;
    let target = free_path(dir, &safe_name(name));
    let partial = target.with_file_name(format!(
        "{}.part",
        target
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("arquivo")
    ));
    let disk =
        |error: std::io::Error| ApiError::app(format!("Não deu para gravar o arquivo: {error}"));

    let result: Result<(), ApiError> = async {
        let mut file = tokio::fs::File::create(&partial).await.map_err(disk)?;
        let mut stream = response.bytes_stream();
        let mut received = 0u64;
        let mut last = Instant::now();
        on_progress(Progress { received, total });
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| transport(&path, error))?;
            file.write_all(&chunk).await.map_err(disk)?;
            received += chunk.len() as u64;
            if last.elapsed() >= PROGRESS_EVERY {
                last = Instant::now();
                on_progress(Progress { received, total });
            }
        }
        file.flush().await.map_err(disk)?;
        drop(file);
        tokio::fs::rename(&partial, &target).await.map_err(disk)?;
        on_progress(Progress { received, total });
        Ok(())
    }
    .await;
    if let Err(error) = result {
        let _ = tokio::fs::remove_file(&partial).await;
        return Err(error);
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn o_nome_perde_as_pastas_e_os_caracteres_proibidos() {
        assert_eq!(safe_name("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(safe_name("a:b?.png"), "a_b_.png");
        assert_eq!(safe_name("  .. "), "arquivo");
        assert_eq!(safe_name("foto.png"), "foto.png");
    }

    #[test]
    fn o_nome_repetido_ganha_um_numero() {
        let dir = std::env::temp_dir().join(format!("ashtar-dl-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("foto.png"), b"x").unwrap();
        std::fs::write(dir.join("foto (1).png"), b"x").unwrap();
        assert_eq!(free_path(&dir, "foto.png"), dir.join("foto (2).png"));
        assert_eq!(free_path(&dir, "nova.png"), dir.join("nova.png"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn o_id_so_tem_letras_numeros_e_hifens() {
        assert!(valid_id("0190-abc"));
        assert!(!valid_id("../x"));
        assert!(!valid_id(""));
    }
}
