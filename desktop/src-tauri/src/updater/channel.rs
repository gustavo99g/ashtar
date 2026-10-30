//! O canal de atualização (ADR 0013): de qual `latest.json` o updater lê as versões.
//!
//! Quem decide é a API. Depois do `/api/me`, o app chama o comando `set_update_channel`, e o canal
//! fica só na memória, até o app fechar. A verificação da abertura vem antes do login e usa o
//! estável; se o canal da API for o beta, o `set_update_channel` pede outra na hora. Com a API fora
//! do ar, quem é do beta só não recebe a versão beta naquela abertura (o updater nunca volta
//! versão).
//!
//! A variável `ASHTAR_UPDATE_CHANNEL` fica só para o desenvolvimento: quando existe, vence a API.
//! Só `beta` liga o beta, qualquer outro valor é o estável, e vazia conta como ausente.
//!
//! Sem Tauri aqui: só a regra, para os testes rodarem em qualquer sistema.

use serde::Deserialize;

/// De onde vêm as versões. Os nomes são os da API (`update_channel` no `/api/me`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Stable,
    Beta,
}

impl Channel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Beta => "beta",
        }
    }

    /// O valor da variável: vazia é como ausente; `beta`, sem diferenciar maiúsculas, liga o beta;
    /// o resto é o estável, como desde a v0.2.0.
    fn from_env(value: &str) -> Option<Self> {
        let value = value.trim();
        if value.is_empty() {
            None
        } else if value.eq_ignore_ascii_case("beta") {
            Some(Self::Beta)
        } else {
            Some(Self::Stable)
        }
    }
}

/// De onde veio o canal em uso. Só para o log.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Variable,
    Api,
    Default,
}

impl Source {
    pub fn describe(self) -> &'static str {
        match self {
            Self::Variable => "variável",
            Self::Api => "API",
            Self::Default => "padrão",
        }
    }
}

/// O canal das verificações: a variável vence a API; sem nenhuma das duas (a abertura, antes do
/// `/api/me`), o estável.
pub fn resolve(env: Option<&str>, from_api: Option<Channel>) -> (Channel, Source) {
    if let Some(channel) = env.and_then(Channel::from_env) {
        return (channel, Source::Variable);
    }
    match from_api {
        Some(channel) => (channel, Source::Api),
        None => (Channel::Stable, Source::Default),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sem_nada_e_o_estavel() {
        assert_eq!(resolve(None, None), (Channel::Stable, Source::Default));
    }

    #[test]
    fn o_da_api_vale_sem_a_variavel() {
        assert_eq!(
            resolve(None, Some(Channel::Beta)),
            (Channel::Beta, Source::Api)
        );
        assert_eq!(
            resolve(None, Some(Channel::Stable)),
            (Channel::Stable, Source::Api)
        );
    }

    #[test]
    fn a_variavel_vence_a_api() {
        assert_eq!(
            resolve(Some("beta"), Some(Channel::Stable)),
            (Channel::Beta, Source::Variable)
        );
        assert_eq!(
            resolve(Some("estavel"), Some(Channel::Beta)),
            (Channel::Stable, Source::Variable)
        );
    }

    #[test]
    fn so_beta_liga_o_beta_na_variavel() {
        assert_eq!(resolve(Some(" BETA "), None).0, Channel::Beta);
        assert_eq!(resolve(Some("stable"), None).0, Channel::Stable);
        assert_eq!(resolve(Some("sim"), None).0, Channel::Stable);
    }

    #[test]
    fn variavel_vazia_conta_como_ausente() {
        assert_eq!(
            resolve(Some(""), Some(Channel::Beta)),
            (Channel::Beta, Source::Api)
        );
        assert_eq!(
            resolve(Some("  "), None),
            (Channel::Stable, Source::Default)
        );
    }

    #[test]
    fn os_nomes_sao_os_da_api() {
        let beta: Channel = serde_json::from_str("\"beta\"").unwrap();
        let stable: Channel = serde_json::from_str("\"stable\"").unwrap();
        assert_eq!((beta, stable), (Channel::Beta, Channel::Stable));
        assert!(serde_json::from_str::<Channel>("\"Beta\"").is_err());
        assert_eq!(Channel::Beta.as_str(), "beta");
        assert_eq!(Channel::Stable.as_str(), "stable");
    }
}
