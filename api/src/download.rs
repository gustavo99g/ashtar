//! O link do "Baixar para Windows" da página do convite (`GET /download`).
//!
//! A API lê o `latest.json` do canal estável, o mesmo que o atualizador do app
//! lê, e manda o navegador para o instalador que está lá. Assim o link nunca
//! aponta para uma versão velha. A resposta fica guardada por 10 minutos; se o
//! GitHub não responder, o link vai para a página de versões, onde o instalador
//! também está.

use std::future::Future;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// O `latest.json` da última versão estável (o GitHub redireciona para o arquivo).
pub const LATEST_JSON_URL: &str =
    "https://github.com/gustavo99g/ashtar-releases/releases/latest/download/latest.json";

/// Para onde o botão vai quando o `latest.json` não serve.
pub const RELEASES_URL: &str = "https://github.com/gustavo99g/ashtar-releases/releases";

/// Por quanto tempo a URL do instalador fica guardada.
const CACHE_FOR: Duration = Duration::from_secs(10 * 60);

/// Tempo máximo para o GitHub responder.
const TIMEOUT: Duration = Duration::from_secs(5);

pub struct DownloadLink {
    client: reqwest::Client,
    /// Quando a URL foi lida, e a URL.
    cached: Mutex<Option<(Instant, String)>>,
}

impl Default for DownloadLink {
    fn default() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(TIMEOUT)
                .build()
                .expect("o cliente HTTP deveria abrir"),
            cached: Mutex::new(None),
        }
    }
}

impl DownloadLink {
    /// A URL do instalador do Windows, ou a página de versões.
    pub async fn url(&self) -> String {
        self.url_at(Instant::now(), || fetch(&self.client)).await
    }

    /// Como [`url`](Self::url), com o instante e a leitura vindos de fora, para o
    /// teste conferir o tempo da cópia guardada sem rede.
    async fn url_at<F, Fut>(&self, now: Instant, fetch: F) -> String
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<String, String>>,
    {
        if let Some((at, url)) = self.cached.lock().unwrap().as_ref()
            && now.duration_since(*at) < CACHE_FOR
        {
            return url.clone();
        }
        let url = fetch().await.unwrap_or_else(|error| {
            eprintln!("latest.json: {error}");
            RELEASES_URL.to_owned()
        });
        *self.cached.lock().unwrap() = Some((now, url.clone()));
        url
    }
}

async fn fetch(client: &reqwest::Client) -> Result<String, String> {
    let response = client
        .get(LATEST_JSON_URL)
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|error| error.to_string())?;
    let body = response.text().await.map_err(|error| error.to_string())?;
    installer_url(&body).ok_or_else(|| "sem o instalador do Windows".to_owned())
}

/// A URL do instalador do Windows num `latest.json` do Tauri:
/// `platforms["windows-x86_64-nsis"].url`, ou `platforms["windows-x86_64"].url`.
/// Só aceita `https://`.
pub fn installer_url(latest_json: &str) -> Option<String> {
    let manifest: serde_json::Value = serde_json::from_str(latest_json).ok()?;
    let platforms = manifest.get("platforms")?;
    ["windows-x86_64-nsis", "windows-x86_64"]
        .iter()
        .find_map(|key| platforms.get(key)?.get("url")?.as_str())
        .filter(|url| url.starts_with("https://"))
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXE: &str = "https://github.com/gustavo99g/ashtar-releases/releases/download/v0.2.0/Ashtar_0.2.0_x64-setup.exe";

    #[test]
    fn acha_o_instalador_no_latest_json() {
        let manifest = format!(
            r#"{{"version":"0.2.0","notes":"","pub_date":"2026-10-01T00:00:00Z",
                "platforms":{{"windows-x86_64":{{"signature":"x","url":"{EXE}"}},
                              "windows-x86_64-nsis":{{"signature":"x","url":"{EXE}"}}}}}}"#
        );
        assert_eq!(installer_url(&manifest).as_deref(), Some(EXE));

        // Só com a chave antiga.
        let only_old = format!(r#"{{"platforms":{{"windows-x86_64":{{"url":"{EXE}"}}}}}}"#);
        assert_eq!(installer_url(&only_old).as_deref(), Some(EXE));
    }

    #[test]
    fn latest_json_sem_instalador_nao_serve() {
        for manifest in [
            "",
            "Not Found",
            "{}",
            r#"{"platforms":{}}"#,
            r#"{"platforms":{"linux-x86_64":{"url":"https://x/app.AppImage"}}}"#,
            r#"{"platforms":{"windows-x86_64":{"url":"http://x/setup.exe"}}}"#,
            r#"{"platforms":{"windows-x86_64":{"url":5}}}"#,
        ] {
            assert_eq!(installer_url(manifest), None, "{manifest}");
        }
    }

    #[tokio::test]
    async fn guarda_por_10_minutos_e_cai_para_a_pagina_de_versoes() {
        let link = DownloadLink::default();
        let start = Instant::now();

        let first = link.url_at(start, || async { Ok("https://a".to_owned()) });
        assert_eq!(first.await, "https://a");

        // Dentro dos 10 minutos, nem pergunta.
        let cached = link.url_at(start + Duration::from_secs(9 * 60), || async {
            panic!("não deveria buscar de novo")
        });
        assert_eq!(cached.await, "https://a");

        // Depois, busca de novo; se falhar, vai para a página de versões.
        let failed = link.url_at(start + CACHE_FOR, || async { Err("fora do ar".to_owned()) });
        assert_eq!(failed.await, RELEASES_URL);
    }
}
