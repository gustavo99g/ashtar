//! O cliente HTTP do Rust para a API (ADR 0013).
//!
//! Só os comandos `login` e `redeem` (`commands/identity.rs`) o usam: são as duas chamadas que
//! levam a chave deste computador, e a chave não passa pelo JavaScript. Toda outra chamada sai do
//! `apiFetch` do frontend, com o token que esses comandos devolvem.
//!
//! O que vale igual ao `apiFetch` (`desktop/src/lib/api/client.ts`), para o frontend tratar os
//! dois do mesmo jeito: os cabeçalhos `X-App-Version` e `X-Access-Code`, o limite de 10 segundos
//! e o erro [`ApiError`].
//!
//! O log diz o caminho e o `kind` de cada falha; nunca o corpo do pedido (que tem a chave) nem o
//! token da resposta.

mod config;
mod error;

use std::sync::OnceLock;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::Serialize;
use tauri::AppHandle;
use tracing::warn;

pub use error::ApiError;

/// O mesmo limite do `apiFetch`.
const TIMEOUT: Duration = Duration::from_secs(10);

/// Manda `body` em JSON para `path` (por exemplo `/api/auth/login`) e lê a resposta.
pub async fn post<B, T>(app: &AppHandle, path: &str, body: &B) -> Result<T, ApiError>
where
    B: Serialize + ?Sized,
    T: DeserializeOwned,
{
    let base = config::api_url().ok_or_else(|| {
        ApiError::app(
            "VITE_API_URL não está configurada. Defina no .env da raiz e gere o app de novo.",
        )
    })?;

    // A versão do app é a do tauri.conf.json, que vem do package.json: a mesma do frontend.
    let mut request = client()?
        .post(format!("{base}{path}"))
        .header("X-App-Version", app.package_info().version.to_string())
        .json(body);
    if let Some(code) = config::access_code() {
        request = request.header("X-Access-Code", code);
    }

    let response = request
        .send()
        .await
        .map_err(|error| transport(path, error))?;
    let status = response.status().as_u16();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| transport(path, error))?;

    if !(200..300).contains(&status) {
        let error = ApiError::from_response(status, &bytes);
        warn!(path, status, kind = %error.kind, "a API recusou o pedido");
        return Err(error);
    }
    serde_json::from_slice(&bytes).map_err(|error| {
        warn!(path, %error, "a resposta da API veio num formato inesperado");
        ApiError::unexpected_body(status)
    })
}

/// Um cliente só para o app inteiro: ele guarda as conexões abertas entre um pedido e outro.
fn client() -> Result<&'static reqwest::Client, ApiError> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }

    // O reqwest daqui é o do updater, com a feature `rustls-no-provider`: ele não escolhe a
    // criptografia sozinho e, sem um provedor instalado, o `build()` entra em pânico. O updater
    // instala o `ring` na primeira verificação, mas o login pode vir antes. Se já houver um
    // provedor, `install_default` só devolve um erro, que não importa.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        // A chave vai só para o endereço do build, nunca para onde um redirecionamento mandar.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| ApiError::app(format!("não foi possível preparar o HTTP: {error}")))?;
    Ok(CLIENT.get_or_init(|| client))
}

/// Uma falha sem resposta da API: o limite de tempo ou a rede.
fn transport(path: &str, error: reqwest::Error) -> ApiError {
    let failure = if error.is_timeout() {
        ApiError::timeout()
    } else {
        ApiError::network()
    };
    warn!(path, kind = %failure.kind, %error, "sem resposta da API");
    failure
}
