//! Confere quem chama as rotas de `/api` (decisões 8 e 11 de `docs/plans/v0.2.0-base-de-entrega.md`).
//!
//! - `MIN_CLIENT_VERSION`: abaixo dela, ou sem o cabeçalho `X-App-Version`,
//!   a resposta é 426 com `{ kind: "client_outdated", message, min_version }`.
//!
//! Variável ausente ou vazia desliga a conferência. Quem manda de verdade é a sessão
//! (`/api/me`, o token do app): a versão só diz ao app antigo que ele precisa atualizar.
//! O código de acesso provisório (`ACCESS_CODE`, `X-Access-Code`) saiu na v0.2.2.

use std::sync::Arc;

use axum::Json;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use semver::Version;

use crate::error::{ErrorBody, ErrorKind};

const APP_VERSION_HEADER: &str = "x-app-version";

#[derive(Debug, Clone, Default)]
pub struct ClientPolicy {
    pub min_version: Option<Version>,
}

impl ClientPolicy {
    /// Lê as variáveis de ambiente. Uma `MIN_CLIENT_VERSION` inválida derruba
    /// a API na partida: melhor do que subir sem conferir nada sem perceber.
    pub fn from_env() -> Self {
        let min_version = non_empty_env("MIN_CLIENT_VERSION").map(|value| {
            Version::parse(&value)
                .unwrap_or_else(|error| panic!("MIN_CLIENT_VERSION inválida ({value}): {error}"))
        });

        Self { min_version }
    }
    /// `Err` com a resposta pronta se a chamada deve ser recusada.
    ///
    /// A resposta vai em `Box` porque o `Response` é grande e o caminho feliz é o comum.
    pub fn check(&self, headers: &HeaderMap) -> Result<(), Box<Response>> {
        if let Some(min_version) = &self.min_version {
            let version = header(headers, APP_VERSION_HEADER).and_then(|v| Version::parse(v).ok());

            match version {
                Some(version) if version >= *min_version => {}
                _ => return Err(Box::new(outdated(min_version))),
            }
        }

        Ok(())
    }
}

/// Middleware do axum: aplica a [`ClientPolicy`] antes da rota.
pub async fn enforce(
    State(policy): State<Arc<ClientPolicy>>,
    request: Request,
    next: Next,
) -> Response {
    if let Err(response) = policy.check(request.headers()) {
        return *response;
    }
    next.run(request).await
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|value| value.to_str().ok())
}

fn non_empty_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn outdated(min_version: &Version) -> Response {
    let body = ErrorBody {
        kind: ErrorKind::ClientOutdated,
        message: format!(
            "Esta versão do Ashtar é antiga demais. A atualização para a {min_version} está sendo baixada; reinicie quando o aviso aparecer."
        ),
        min_version: Some(min_version.to_string()),
    };
    (StatusCode::UPGRADE_REQUIRED, Json(body)).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(pairs: &[(&'static str, &'static str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.insert(*name, value.parse().unwrap());
        }
        map
    }

    fn policy(min_version: Option<&str>) -> ClientPolicy {
        ClientPolicy {
            min_version: min_version.map(|v| Version::parse(v).unwrap()),
        }
    }

    fn status(result: Result<(), Box<Response>>) -> Option<StatusCode> {
        result.err().map(|response| response.status())
    }

    #[test]
    fn sem_variaveis_tudo_passa() {
        assert_eq!(status(policy(None).check(&headers(&[]))), None);
    }

    #[test]
    fn versao_abaixo_da_minima_recebe_426() {
        let policy = policy(Some("0.2.1"));
        let old = headers(&[("x-app-version", "0.2.0")]);
        assert_eq!(
            status(policy.check(&old)),
            Some(StatusCode::UPGRADE_REQUIRED)
        );
    }

    #[test]
    fn versao_igual_ou_acima_passa() {
        let policy = policy(Some("0.2.1"));
        assert_eq!(
            status(policy.check(&headers(&[("x-app-version", "0.2.1")]))),
            None
        );
        assert_eq!(
            status(policy.check(&headers(&[("x-app-version", "0.2.10")]))),
            None
        );
    }

    #[test]
    fn sem_cabecalho_ou_versao_invalida_recebe_426() {
        let policy = policy(Some("0.2.0"));
        assert_eq!(
            status(policy.check(&headers(&[]))),
            Some(StatusCode::UPGRADE_REQUIRED)
        );
        let garbage = headers(&[("x-app-version", "abc")]);
        assert_eq!(
            status(policy.check(&garbage)),
            Some(StatusCode::UPGRADE_REQUIRED)
        );
    }

    #[test]
    fn o_codigo_de_acesso_antigo_nao_vale_mais() {
        // Um app antigo ainda manda o `X-Access-Code`: a API ignora, não recusa.
        let with_code = headers(&[("x-access-code", "qualquer")]);
        assert_eq!(status(policy(None).check(&with_code)), None);
    }
}
