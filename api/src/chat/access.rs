//! A regra de leitura (ADR 0021): o que alguém pode ler e onde pode escrever.
//!
//! Toda rota de mensagens passa por [`readable`]. Hoje ela conhece dois casos:
//! o canal de texto aberto, que é de todo membro ativo, e a conversa privada,
//! que é só das duas pessoas dela. É aqui que entra, depois, o canal que só
//! algumas pessoas veem.

use sqlx::SqlitePool;

use super::channels::{self, Channel};
use super::dms::{self, Dm};
use crate::error::ApiError;
use crate::identity::User;

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
    Ok(Readable::Text(
        channels::get_open_text(db, channel_id).await?,
    ))
}
