//! O status de cada pessoa (ADR 0022 e 0027): Disponível, Ausente, Ocupado ou
//! Invisível. O Ausente também chega sozinho, por inatividade, mas esse não é
//! gravado: é das conexões, e quem decide é o hub.
//!
//! São dois tipos de propósito. O [`Status`] é o de verdade: só a própria
//! pessoa o vê (`GET /api/me`, o `ready` dela, o `status.changed`). O [`Shown`]
//! é o que os outros veem, e nele não existe "invisível": o que vai para os
//! outros (`Person`, `presence.changed`) é do tipo [`Shown`], então não há
//! como um invisível vazar por esquecimento. Para os outros, quem está
//! invisível está offline.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;

use crate::error::ApiError;

/// O status que a pessoa escolheu.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
pub enum Status {
    Available,
    /// Ausente escolhido à mão. Não cala nada: só os outros veem a lua.
    Away,
    /// Não perturbe: o app dela cala avisos, sons e o toque. Os outros veem.
    Busy,
    /// Para os outros, offline. Ela continua recebendo tudo.
    Invisible,
}

/// O status como os outros veem quem está online.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
pub enum Shown {
    Available,
    /// Escolhido, ou Disponível sem mexer no computador há 10 minutos.
    Away,
    Busy,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Available => "available",
            Self::Away => "away",
            Self::Busy => "busy",
            Self::Invisible => "invisible",
        }
    }

    fn parse(text: &str) -> Option<Self> {
        match text {
            "available" => Some(Self::Available),
            "away" => Some(Self::Away),
            "busy" => Some(Self::Busy),
            "invisible" => Some(Self::Invisible),
            _ => None,
        }
    }

    /// O que os outros veem de alguém online com este status. `None`: nada,
    /// a pessoa aparece offline.
    pub fn shown(self) -> Option<Shown> {
        match self {
            Self::Available => Some(Shown::Available),
            Self::Away => Some(Shown::Away),
            Self::Busy => Some(Shown::Busy),
            Self::Invisible => None,
        }
    }
}

/// O status de `user_id`.
pub async fn get(db: &SqlitePool, user_id: &str) -> Result<Status, ApiError> {
    let text: String = sqlx::query_scalar("SELECT status FROM users WHERE id = ?")
        .bind(user_id)
        .fetch_one(db)
        .await?;
    Status::parse(&text)
        .ok_or_else(|| ApiError::Config(format!("status fora do esperado no banco: {text}")))
}

pub async fn set(db: &SqlitePool, user_id: &str, status: Status) -> Result<(), ApiError> {
    sqlx::query("UPDATE users SET status = ? WHERE id = ?")
        .bind(status.as_str())
        .bind(user_id)
        .execute(db)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn o_texto_do_banco_e_o_do_json_sao_o_mesmo() {
        for status in [
            Status::Available,
            Status::Away,
            Status::Busy,
            Status::Invisible,
        ] {
            assert_eq!(Status::parse(status.as_str()), Some(status));
            assert_eq!(
                serde_json::to_value(status).unwrap(),
                serde_json::json!(status.as_str())
            );
        }
        assert_eq!(Status::parse("ausente"), None);
    }

    #[test]
    fn o_invisivel_nao_tem_o_que_mostrar() {
        assert_eq!(Status::Available.shown(), Some(Shown::Available));
        assert_eq!(Status::Busy.shown(), Some(Shown::Busy));
        assert_eq!(Status::Invisible.shown(), None);
    }
}
