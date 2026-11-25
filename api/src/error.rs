//! Erros das regras de identidade e como cada um vira resposta HTTP.
//!
//! O corpo é um [`ErrorBody`]: `{ kind, message }`, com a mensagem pronta para
//! mostrar à pessoa (o `client_policy` usa o mesmo corpo). O `admin` mostra só a
//! mensagem. O [`ErrorKind`] vira uma união de textos no TypeScript do app.

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use ts_rs::TS;

/// O `kind` de toda recusa da API. O app decide o que mostrar por ele, nunca
/// pela mensagem.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
pub enum ErrorKind {
    Unauthenticated,
    UnknownDevice,
    Forbidden,
    InvalidInvite,
    InvalidNick,
    InvalidDisplayName,
    NickTaken,
    InvalidDeviceKey,
    DeviceAlreadyLinked,
    InvalidRequest,
    NotFound,
    Conflict,
    TooManyAttempts,
    /// Mensagens demais em pouco tempo (o limite de envio do chat).
    TooManyMessages,
    /// Sons demais em pouco tempo, ou antes do intervalo entre um e outro (ADR 0037).
    TooManySounds,
    Internal,
    /// Da `ClientPolicy`: o app está abaixo da versão mínima (426).
    ClientOutdated,
    /// A sala já tem o máximo de transmissões ao mesmo tempo (`MAX_SHARES_PER_ROOM`, ADR 0024).
    ShareLimit,
    /// O pedido passou do tempo limite (`timeout.rs`). O app usa o mesmo texto para o seu.
    Timeout,
    /// O arquivo passa do tamanho que o tipo aceita (413, ADR 0031).
    FileTooLarge,
    /// O disco do servidor tem menos de 1 GB livre (507, ADR 0031).
    DiskFull,
}

/// Por que um convite foi recusado (v0.9): o app e a página do link mostram o motivo certo, em vez de juntar
/// os quatro casos num texto só. Dizer o motivo não abre brecha: o código tem entropia de sobra para ninguém
/// achar um por tentativa, e toda recusa continua contando no limite de tentativas.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
pub enum InviteRefusal {
    /// Nenhum convite com esse código (ou o código nem tem o formato de um).
    NotFound,
    Expired,
    /// Todos os usos foram gastos.
    Used,
    /// Revogado pelo Painel, ou a recuperação de quem foi removido do grupo.
    Revoked,
}

impl InviteRefusal {
    /// O texto que a pessoa vê.
    pub fn message(self) -> &'static str {
        match self {
            Self::NotFound => "Esse código não existe. Confira se copiou o link inteiro.",
            Self::Expired => "Esse convite venceu. Peça um novo ao dono do grupo.",
            Self::Used => "Esse convite já foi usado. Peça um novo ao dono do grupo.",
            Self::Revoked => "Esse convite foi cancelado. Peça um novo ao dono do grupo.",
        }
    }
}

/// O corpo de toda resposta de erro.
#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct ErrorBody {
    pub kind: ErrorKind,
    pub message: String,
    /// Só no `client_outdated`: a versão mínima que a API aceita.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub min_version: Option<String>,
    /// Só no `invalid_invite`: o motivo da recusa. Campo novo da v0.9; o app antigo só lê o `kind`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reason: Option<InviteRefusal>,
}

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("Sessão inválida. Entre de novo.")]
    Unauthenticated,
    #[error("Este computador não está vinculado a nenhum membro.")]
    UnknownDevice,
    #[error("Você não tem permissão para isso.")]
    Forbidden,
    #[error("{}", .0.message())]
    InvalidInvite(InviteRefusal),
    #[error("{0}")]
    InvalidNick(&'static str),
    #[error("{0}")]
    InvalidDisplayName(&'static str),
    #[error("Esse nick já está em uso.")]
    NickTaken,
    #[error("Chave do dispositivo inválida.")]
    InvalidDeviceKey,
    #[error("Este computador já está vinculado a um membro.")]
    DeviceAlreadyLinked,
    /// Dado de entrada fora do que a regra aceita (tamanho, faixa, combinação).
    #[error("{0}")]
    InvalidRequest(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("Muitas tentativas. Espere alguns minutos e tente de novo.")]
    TooManyAttempts,
    #[error("Calma: muitas mensagens seguidas.")]
    TooManyMessages,
    #[error("Calma: espere um pouco para tocar outro som.")]
    TooManySounds,
    /// A sala chegou ao limite de transmissões; o número é o limite.
    #[error("Já tem {0} transmissões nesta sala. Espere uma acabar para transmitir.")]
    ShareLimit(usize),
    #[error("Erro interno no servidor.")]
    Internal(#[from] sqlx::Error),
    /// Falta configuração no servidor (uma variável do `.env`, por exemplo).
    #[error("Erro interno no servidor.")]
    Config(String),
    /// O LiveKit não respondeu ou recusou o pedido. O detalhe vai só para o log.
    #[error("Não foi possível consultar a sala de voz agora.")]
    LiveKit(String),
    #[error("O servidor demorou demais para responder. Tente de novo em instantes.")]
    Timeout,
    /// O arquivo passou do limite; o texto diz qual ("100 MB").
    #[error("O arquivo passa de {0}.")]
    FileTooLarge(&'static str),
    #[error("O servidor está sem espaço. O dono já foi avisado.")]
    DiskFull,
    /// Um erro de disco ao gravar ou ler um arquivo. O detalhe vai só para o log.
    #[error("Erro interno no servidor.")]
    Io(#[from] std::io::Error),
}

impl ApiError {
    fn status_and_kind(&self) -> (StatusCode, ErrorKind) {
        match self {
            Self::Unauthenticated => (StatusCode::UNAUTHORIZED, ErrorKind::Unauthenticated),
            Self::UnknownDevice => (StatusCode::UNAUTHORIZED, ErrorKind::UnknownDevice),
            Self::Forbidden => (StatusCode::FORBIDDEN, ErrorKind::Forbidden),
            Self::InvalidInvite(_) => (StatusCode::BAD_REQUEST, ErrorKind::InvalidInvite),
            Self::InvalidNick(_) => (StatusCode::UNPROCESSABLE_ENTITY, ErrorKind::InvalidNick),
            Self::InvalidDisplayName(_) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                ErrorKind::InvalidDisplayName,
            ),
            Self::NickTaken => (StatusCode::CONFLICT, ErrorKind::NickTaken),
            Self::InvalidDeviceKey => (
                StatusCode::UNPROCESSABLE_ENTITY,
                ErrorKind::InvalidDeviceKey,
            ),
            Self::DeviceAlreadyLinked => (StatusCode::CONFLICT, ErrorKind::DeviceAlreadyLinked),
            Self::InvalidRequest(_) => {
                (StatusCode::UNPROCESSABLE_ENTITY, ErrorKind::InvalidRequest)
            }
            Self::NotFound(_) => (StatusCode::NOT_FOUND, ErrorKind::NotFound),
            Self::Conflict(_) => (StatusCode::CONFLICT, ErrorKind::Conflict),
            Self::TooManyAttempts => (StatusCode::TOO_MANY_REQUESTS, ErrorKind::TooManyAttempts),
            Self::TooManyMessages => (StatusCode::TOO_MANY_REQUESTS, ErrorKind::TooManyMessages),
            Self::TooManySounds => (StatusCode::TOO_MANY_REQUESTS, ErrorKind::TooManySounds),
            Self::ShareLimit(_) => (StatusCode::CONFLICT, ErrorKind::ShareLimit),
            Self::Timeout => (StatusCode::GATEWAY_TIMEOUT, ErrorKind::Timeout),
            Self::FileTooLarge(_) => (StatusCode::PAYLOAD_TOO_LARGE, ErrorKind::FileTooLarge),
            Self::DiskFull => (StatusCode::INSUFFICIENT_STORAGE, ErrorKind::DiskFull),
            Self::Internal(_) | Self::Config(_) | Self::LiveKit(_) | Self::Io(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, ErrorKind::Internal)
            }
        }
    }
}

/// A violação de um índice único do SQLite, se `error` for uma. Devolve a
/// mensagem do banco (`UNIQUE constraint failed: ...`), para quem chama
/// decidir qual erro de regra ela significa.
pub(crate) fn unique_violation(error: &sqlx::Error) -> Option<&str> {
    match error {
        sqlx::Error::Database(db) if db.is_unique_violation() => Some(db.message()),
        _ => None,
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        match &self {
            Self::Internal(error) => eprintln!("erro interno: {error}"),
            Self::Config(message) => eprintln!("configuração: {message}"),
            Self::LiveKit(message) => eprintln!("livekit: {message}"),
            Self::Io(error) => eprintln!("disco: {error}"),
            _ => {}
        }
        let (status, kind) = self.status_and_kind();
        let body = ErrorBody {
            kind,
            message: self.to_string(),
            min_version: None,
            reason: match self {
                Self::InvalidInvite(reason) => Some(reason),
                _ => None,
            },
        };
        (status, Json(body)).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn o_corpo_so_traz_a_versao_minima_quando_ela_existe() {
        let body = ErrorBody {
            kind: ErrorKind::NickTaken,
            message: "Esse nick já está em uso.".into(),
            min_version: None,
            reason: None,
        };
        assert_eq!(
            serde_json::to_value(&body).unwrap(),
            json!({ "kind": "nick_taken", "message": "Esse nick já está em uso." })
        );

        let body = ErrorBody {
            kind: ErrorKind::ClientOutdated,
            message: "Atualize.".into(),
            min_version: Some("0.2.20".into()),
            reason: None,
        };
        assert_eq!(
            serde_json::to_value(&body).unwrap(),
            json!({ "kind": "client_outdated", "message": "Atualize.", "min_version": "0.2.20" })
        );
    }
}
