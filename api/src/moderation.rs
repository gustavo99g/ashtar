//! A moderação na voz (ADR 0034): o estado imposto (silenciado e surdo), guardado no banco, e o
//! que ele vira no LiveKit.
//!
//! As rotas (`routes/moderation.rs`) gravam aqui e chamam [`crate::voice`] para o LiveKit garantir
//! o que a API impôs, sem depender do app de quem foi moderado.

use std::collections::HashMap;

use livekit_protocol::{ParticipantPermission, TrackSource};
use serde::Serialize;
use sqlx::SqlitePool;
use ts_rs::TS;

use crate::error::ApiError;

/// O que a moderação impôs a alguém. Os dois desligados é ninguém moderado.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Imposed {
    pub mic_muted: bool,
    pub deafened: bool,
}

impl Imposed {
    pub fn is_free(self) -> bool {
        !self.mic_muted && !self.deafened
    }

    /// As fontes que o token de voz deixa publicar: sem o microfone para quem foi silenciado;
    /// vazio (todas) para os outros.
    pub fn token_sources(self) -> Vec<String> {
        if self.mic_muted {
            ["camera", "screen_share", "screen_share_audio"]
                .map(String::from)
                .to_vec()
        } else {
            Vec::new()
        }
    }

    /// A permissão que a API manda ao LiveKit (`UpdateParticipant`) para a conexão de voz: a do
    /// token de voz, com as restrições. Liberar é mandar a de quem não tem nenhuma.
    pub fn permission(self) -> ParticipantPermission {
        ParticipantPermission {
            can_subscribe: !self.deafened,
            can_publish: true,
            can_publish_data: true,
            can_publish_sources: if self.mic_muted {
                vec![
                    TrackSource::Camera as i32,
                    TrackSource::ScreenShare as i32,
                    TrackSource::ScreenShareAudio as i32,
                ]
            } else {
                Vec::new()
            },
            can_update_metadata: false,
            ..Default::default()
        }
    }
}

/// O que a moderação fez, no `voice.moderated` que vai para a pessoa moderada.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
pub enum ModerationAction {
    Mute,
    Unmute,
    Deafen,
    Undeafen,
    CameraOff,
    StopShare,
}

impl ModerationAction {
    /// A chave que vai para o registro (`audit_log.action`).
    pub fn key(self) -> &'static str {
        match self {
            Self::Mute => "voz.silenciar",
            Self::Unmute => "voz.liberar_microfone",
            Self::Deafen => "voz.surdo",
            Self::Undeafen => "voz.liberar_audio",
            Self::CameraOff => "voz.desligar_camera",
            Self::StopShare => "voz.encerrar_transmissao",
        }
    }
}

/// O estado imposto a `user_id`.
pub async fn get(db: &SqlitePool, user_id: &str) -> Result<Imposed, ApiError> {
    let row: Option<(bool, bool)> =
        sqlx::query_as("SELECT mic_muted, deafened FROM voice_moderation WHERE user_id = ?")
            .bind(user_id)
            .fetch_optional(db)
            .await?;
    Ok(row
        .map(|(mic_muted, deafened)| Imposed {
            mic_muted,
            deafened,
        })
        .unwrap_or_default())
}

/// Todo mundo que está moderado agora.
pub async fn all(db: &SqlitePool) -> Result<HashMap<String, Imposed>, ApiError> {
    let rows: Vec<(String, bool, bool)> =
        sqlx::query_as("SELECT user_id, mic_muted, deafened FROM voice_moderation")
            .fetch_all(db)
            .await?;
    Ok(rows
        .into_iter()
        .map(|(id, mic_muted, deafened)| {
            (
                id,
                Imposed {
                    mic_muted,
                    deafened,
                },
            )
        })
        .collect())
}

/// Grava o estado novo de `user_id` (feito por `by`) e devolve ele. Sem nada imposto, apaga a
/// linha.
pub async fn set(
    db: &SqlitePool,
    user_id: &str,
    imposed: Imposed,
    by: &str,
    now: i64,
) -> Result<Imposed, ApiError> {
    if imposed.is_free() {
        sqlx::query("DELETE FROM voice_moderation WHERE user_id = ?")
            .bind(user_id)
            .execute(db)
            .await?;
    } else {
        sqlx::query(
            "INSERT INTO voice_moderation (user_id, mic_muted, deafened, by_user_id, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (user_id) DO UPDATE SET mic_muted = excluded.mic_muted,
                 deafened = excluded.deafened, by_user_id = excluded.by_user_id,
                 updated_at = excluded.updated_at",
        )
        .bind(user_id)
        .bind(imposed.mic_muted)
        .bind(imposed.deafened)
        .bind(by)
        .bind(now)
        .execute(db)
        .await?;
    }
    Ok(imposed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silenciado_publica_tudo_menos_o_microfone() {
        let muted = Imposed {
            mic_muted: true,
            deafened: false,
        };
        assert_eq!(
            muted.token_sources(),
            ["camera", "screen_share", "screen_share_audio"]
        );
        let permission = muted.permission();
        assert!(permission.can_subscribe && permission.can_publish);
        assert!(
            !permission
                .can_publish_sources
                .contains(&(TrackSource::Microphone as i32))
        );
    }

    #[test]
    fn surdo_nao_recebe_e_liberado_volta_ao_normal() {
        let deaf = Imposed {
            mic_muted: false,
            deafened: true,
        };
        assert!(!deaf.permission().can_subscribe);
        assert!(deaf.token_sources().is_empty());
        let free = Imposed::default();
        assert!(free.is_free());
        assert!(free.permission().can_subscribe);
        assert!(free.permission().can_publish_sources.is_empty());
    }
}
