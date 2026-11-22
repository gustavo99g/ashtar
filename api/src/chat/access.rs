//! A regra de leitura (ADR 0021): o que alguém pode ler e onde pode escrever.
//!
//! Toda rota de mensagens passa por [`readable`], e toda rota de voz por
//! [`joinable`]. Os casos são três: o canal aberto, que é de todo membro ativo;
//! o canal restrito (ADR 0028), que é de quem está na lista dele, do dono e de
//! quem gerencia os canais; e a conversa privada, que é só das duas pessoas.
//! Quem não acessa recebe o mesmo `NotFound` de um id que não existe.
//!
//! O que sai pelo tempo real com o id de um canal passa pelo [`audience`].

use std::sync::Arc;

use sqlx::SqlitePool;

use super::channels::{self, Channel};
use super::dms::{self, Dm};
use crate::error::ApiError;
use crate::identity::User;
use crate::identity::permissions::{self, Permission};
use crate::realtime::Audience;

/// Um lugar com mensagens que a pessoa pode ler.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Readable {
    /// Um canal de texto aberto: todos leem.
    Text(Channel),
    /// Uma conversa privada de que a pessoa faz parte.
    Dm(Dm),
}

impl Readable {
    /// O id do canal, o `channel_id` das mensagens.
    pub fn id(&self) -> &str {
        match self {
            Self::Text(channel) => &channel.id,
            Self::Dm(dm) => &dm.id,
        }
    }
}

/// O canal de texto aberto `channel_id`, ou a conversa privada `channel_id`
/// de que `user` faz parte.
///
/// Todo o resto é o mesmo `NotFound`, com a mesma mensagem: um id que não
/// existe, uma sala de voz, um canal arquivado e a conversa dos outros. Para
/// quem não é da conversa, a API não confirma que ela existe.
pub async fn readable(
    db: &SqlitePool,
    user: &User,
    channel_id: &str,
) -> Result<Readable, ApiError> {
    if let Some(dm) = dms::find_for(db, &user.id, channel_id).await? {
        return Ok(Readable::Dm(dm));
    }
    // Uma `dm` dos outros não passa daqui: o `get_open_text` só acha `text`.
    let channel = channels::get_open_text(db, channel_id).await?;
    if !can_access(db, user, &channel).await? {
        return Err(ApiError::NotFound(
            "Esse canal não existe ou foi arquivado.".into(),
        ));
    }
    Ok(Readable::Text(channel))
}

/// A sala de voz aberta `channel_id`, se `user` pode entrar nela. A restrita de
/// que ele não faz parte dá o mesmo `NotFound` de uma sala que não existe.
pub async fn joinable(db: &SqlitePool, user: &User, channel_id: &str) -> Result<Channel, ApiError> {
    let channel = channels::get_open_voice(db, channel_id).await?;
    if !can_access(db, user, &channel).await? {
        return Err(ApiError::NotFound(
            "Essa sala não existe ou foi arquivada.".into(),
        ));
    }
    Ok(channel)
}

/// Se `user` gerencia os canais: o dono ou quem tem "Gerenciar canais". Vê todo
/// canal restrito, para poder editar a lista dele.
pub async fn manages_channels(db: &SqlitePool, user: &User) -> Result<bool, ApiError> {
    permissions::has(db, user, Permission::ManageChannels).await
}

/// Se `user` acessa o canal `channel` (de texto ou de voz, aberto ou não): sem
/// restrição, todos; restrito, quem está na lista, o dono e quem gerencia.
pub async fn can_access(db: &SqlitePool, user: &User, channel: &Channel) -> Result<bool, ApiError> {
    if !user.is_active() {
        return Ok(false);
    }
    if !channel.restricted {
        return Ok(true);
    }
    if is_listed(db, &channel.id, &user.id).await? {
        return Ok(true);
    }
    manages_channels(db, user).await
}

/// Se `user_id` está na lista do canal `channel_id`.
pub async fn is_listed(db: &SqlitePool, channel_id: &str, user_id: &str) -> Result<bool, ApiError> {
    let found: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?")
            .bind(channel_id)
            .bind(user_id)
            .fetch_optional(db)
            .await?;
    Ok(found.is_some())
}

/// Os membros ativos na lista do canal `channel_id`, em ordem de id.
pub async fn listed(db: &SqlitePool, channel_id: &str) -> Result<Vec<String>, ApiError> {
    Ok(sqlx::query_scalar(
        "SELECT cm.user_id FROM channel_members cm JOIN users u ON u.id = cm.user_id
         WHERE cm.channel_id = ? AND u.removed_at IS NULL ORDER BY cm.user_id",
    )
    .bind(channel_id)
    .fetch_all(db)
    .await?)
}

/// Quem acessa o canal `channel_id`: `None` se é de todos (sem restrição, ou um
/// id que não é de um canal da lista); senão, a lista, o dono e quem gerencia.
pub async fn allowed(db: &SqlitePool, channel_id: &str) -> Result<Option<Vec<String>>, ApiError> {
    let restricted: Option<bool> = sqlx::query_scalar(
        "SELECT restricted FROM channels WHERE id = ? AND kind IN ('text', 'voice')",
    )
    .bind(channel_id)
    .fetch_optional(db)
    .await?;
    if restricted != Some(true) {
        return Ok(None);
    }
    Ok(Some(
        sqlx::query_scalar(
            "SELECT id FROM users WHERE removed_at IS NULL AND (
                 is_owner = 1
                 OR id IN (SELECT user_id FROM user_permissions WHERE permission = ?)
                 OR id IN (SELECT user_id FROM channel_members WHERE channel_id = ?))
             ORDER BY id",
        )
        .bind(Permission::ManageChannels.key())
        .bind(channel_id)
        .fetch_all(db)
        .await?,
    ))
}

/// Para quem vai um evento do canal `channel_id` (uma mensagem, quem está na
/// sala, o "digitando…"): todos, ou só quem acessa o canal restrito.
pub async fn audience(db: &SqlitePool, channel_id: &str) -> Result<Audience, ApiError> {
    Ok(match allowed(db, channel_id).await? {
        None => Audience::Everyone,
        Some(ids) => Audience::Only(Arc::from(ids)),
    })
}
