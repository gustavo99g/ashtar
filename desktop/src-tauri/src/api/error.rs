//! O erro de uma chamada à API feita pelo Rust, no formato do `ApiError` do frontend
//! (`desktop/src/lib/api/errors.ts`): `{ status, kind, message, min_version?, reason? }`.
//!
//! Com o mesmo formato, o `commands.ts` transforma a recusa do comando na mesma classe que o
//! `apiFetch` lança, e as telas tratam um `login` que falhou igual a qualquer outra chamada.

use serde::{Deserialize, Serialize};

/// Os mesmos textos do `errors.ts`.
const NETWORK_MESSAGE: &str =
    "Não foi possível falar com o servidor. Confira a internet ou tente mais tarde.";
const TIMEOUT_MESSAGE: &str =
    "O servidor demorou demais para responder. Tente de novo em instantes.";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{kind} ({status}): {message}")]
pub struct ApiError {
    /// O status HTTP da resposta; 0 quando não houve resposta.
    pub status: u16,
    /// Um `kind` da API (`unknown_device`, `client_outdated`...) ou um do app (`network`,
    /// `timeout`, `http`, `device_key`, `app`), os mesmos do `ClientErrorKind` do frontend.
    pub kind: String,
    pub message: String,
    /// Só no `client_outdated` (426).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_version: Option<String>,
    /// Só no `invalid_invite` (v0.9): o motivo (`not_found`, `expired`, `used`, `revoked`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// O corpo de erro da API (`ErrorBody` em `api/src/error.rs`).
#[derive(Deserialize)]
struct ErrorBody {
    kind: String,
    message: String,
    #[serde(default)]
    min_version: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

impl ApiError {
    /// Um erro que nasceu no app, sem resposta da API.
    fn client(kind: &str, message: impl Into<String>) -> Self {
        Self {
            status: 0,
            kind: kind.to_owned(),
            message: message.into(),
            min_version: None,
            reason: None,
        }
    }

    /// Nenhuma resposta: sem internet, API fora do ar, túnel caído.
    pub fn network() -> Self {
        Self::client("network", NETWORK_MESSAGE)
    }

    /// A API não respondeu dentro do limite de tempo.
    pub fn timeout() -> Self {
        Self::client("timeout", TIMEOUT_MESSAGE)
    }

    /// O Rust não conseguiu a chave deste computador (o motivo vai para o log).
    pub fn device_key() -> Self {
        Self::client(
            "device_key",
            "O app não conseguiu identificar este computador. Feche e abra o Ashtar de novo.",
        )
    }

    /// O próprio app falhou (configuração, tarefa em segundo plano).
    pub fn app(message: impl Into<String>) -> Self {
        Self::client("app", message)
    }

    /// A resposta de erro da API. Sem o corpo `{ kind, message }` (um 502 do túnel, uma página
    /// de erro), o `kind` é `http`, como no `apiFetch`.
    pub fn from_response(status: u16, body: &[u8]) -> Self {
        match serde_json::from_slice::<ErrorBody>(body) {
            Ok(body) => Self {
                status,
                kind: body.kind,
                message: body.message,
                min_version: body.min_version,
                reason: body.reason,
            },
            Err(_) => Self {
                status,
                kind: "http".to_owned(),
                message: "O servidor não respondeu direito. Tente de novo em instantes.".to_owned(),
                min_version: None,
                reason: None,
            },
        }
    }

    /// Uma resposta de sucesso que não tem o formato esperado.
    pub fn unexpected_body(status: u16) -> Self {
        Self {
            status,
            kind: "http".to_owned(),
            message: "O servidor respondeu num formato que o app não entende.".to_owned(),
            min_version: None,
            reason: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn le_o_kind_e_a_versao_minima_do_corpo() {
        let body = br#"{"kind":"client_outdated","message":"Atualize.","min_version":"0.2.2"}"#;
        let error = ApiError::from_response(426, body);
        assert_eq!(error.status, 426);
        assert_eq!(error.kind, "client_outdated");
        assert_eq!(error.message, "Atualize.");
        assert_eq!(error.min_version.as_deref(), Some("0.2.2"));
    }

    #[test]
    fn le_o_motivo_do_convite_recusado() {
        let body = br#"{"kind":"invalid_invite","message":"Venceu.","reason":"expired"}"#;
        let error = ApiError::from_response(400, body);
        assert_eq!(error.reason.as_deref(), Some("expired"));
        assert_eq!(serde_json::to_value(&error).unwrap()["reason"], "expired");
    }

    #[test]
    fn corpo_sem_o_formato_da_api_vira_http() {
        let error = ApiError::from_response(502, b"<html>Bad Gateway</html>");
        assert_eq!(error.kind, "http");
        assert_eq!(error.status, 502);
        assert_eq!(error.min_version, None);
    }

    #[test]
    fn chega_ao_javascript_no_formato_do_api_error() {
        let refused = ApiError::from_response(401, br#"{"kind":"unknown_device","message":"x"}"#);
        assert_eq!(
            serde_json::to_value(&refused).unwrap(),
            json!({ "status": 401, "kind": "unknown_device", "message": "x" })
        );
        let offline = serde_json::to_value(ApiError::network()).unwrap();
        assert_eq!(offline["status"], 0);
        assert_eq!(offline["kind"], "network");
    }
}
