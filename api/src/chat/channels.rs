//! Canais de texto e salas de voz: as regras do nome e do tópico, criar,
//! editar, arquivar e desarquivar.
//!
//! Toda mudança recebe quem está fazendo (`actor`) e confere "Gerenciar canais"
//! antes de tudo, como as ações de `identity`. Ela roda numa transação que
//! também soma 1 na versão da lista ([`super::layout::bump`]) e devolve essa
//! versão, que a rota publica no `channels.changed`.

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqliteConnection, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use super::layout;
use crate::error::ApiError;
use crate::identity::User;
use crate::identity::permissions::{Permission, require_permission};

/// O tipo de um canal da lista. A chave em texto é a do banco.
///
/// A conversa privada (`dm`, ADR 0021) fica de fora de propósito: ela não é um
/// [`Channel`] (não tem nome nem posição), e uma consulta da lista que
/// esquecesse o `kind IN ('text', 'voice')` falha ao ler o tipo, em vez de
/// mostrar a conversa de alguém.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
pub enum ChannelKind {
    Text,
    Voice,
}

/// Um canal como o banco guarda.
#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct Channel {
    pub id: String,
    pub kind: ChannelKind,
    pub name: String,
    pub topic: Option<String>,
    pub category_id: Option<String>,
    pub position: i64,
    pub created_at: i64,
    pub archived_at: Option<i64>,
    /// Só quem está na lista (`channel_members`), o dono e quem gerencia os
    /// canais o veem (ADR 0028).
    pub restricted: bool,
}

/// Um canal como a lista do app mostra.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct ChannelView {
    pub id: String,
    pub kind: ChannelKind,
    pub name: String,
    pub topic: Option<String>,
    /// `null` no topo da lista, fora de categoria.
    pub category_id: Option<String>,
    /// Só na lista de arquivados.
    pub archived_at: Option<i64>,
    /// Restrito a uma lista de pessoas (ADR 0028).
    pub restricted: bool,
    /// Quem está na lista de um canal restrito (só nele). Vai para quem vê o
    /// canal: quem gerencia edita a lista, e o app usa para a sugestão do @ e
    /// para o "Mover para".
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub member_ids: Option<Vec<String>>,
}

impl From<Channel> for ChannelView {
    fn from(channel: Channel) -> Self {
        Self {
            id: channel.id,
            kind: channel.kind,
            name: channel.name,
            topic: channel.topic,
            category_id: channel.category_id,
            archived_at: channel.archived_at,
            restricted: channel.restricted,
            member_ids: None,
        }
    }
}

/// O `#geral` e a `Sala` não podem ser arquivados: o grupo sempre tem onde
/// escrever e onde falar.
pub const PROTECTED: [&str; 2] = ["geral", "sala"];

pub const NAME_MAX: usize = 32;
pub const TOPIC_MAX: usize = 120;

macro_rules! select_channel {
    ($rest:literal) => {
        concat!(
            "SELECT id, kind, name, topic, category_id, position, created_at, archived_at,
                    restricted
             FROM channels ",
            $rest
        )
    };
}
pub(crate) use select_channel;

/// O canal de texto `id`, se existe e não está arquivado. Sala de voz e canal
/// arquivado dão o mesmo `NotFound` de um id que não existe.
pub async fn get_open_text(db: &SqlitePool, id: &str) -> Result<Channel, ApiError> {
    get_open(db, id, ChannelKind::Text)
        .await?
        .ok_or_else(|| ApiError::NotFound("Esse canal não existe ou foi arquivado.".into()))
}

/// A sala de voz `id`, se existe e não está arquivada. Só ela vira sala no
/// LiveKit: sem isto, um token para um id qualquer criaria uma sala nova.
pub async fn get_open_voice(db: &SqlitePool, id: &str) -> Result<Channel, ApiError> {
    get_open(db, id, ChannelKind::Voice)
        .await?
        .ok_or_else(|| ApiError::NotFound("Essa sala não existe ou foi arquivada.".into()))
}

async fn get_open(
    db: &SqlitePool,
    id: &str,
    kind: ChannelKind,
) -> Result<Option<Channel>, ApiError> {
    Ok(sqlx::query_as(select_channel!(
        "WHERE id = ? AND kind = ? AND archived_at IS NULL"
    ))
    .bind(id)
    .bind(kind)
    .fetch_optional(db)
    .await?)
}

async fn get(conn: &mut SqliteConnection, id: &str) -> Result<Channel, ApiError> {
    // Uma conversa privada não é um canal da lista: editar ou arquivar uma pelo
    // id dá o mesmo 404 de um id que não existe.
    let channel: Option<Channel> = sqlx::query_as(select_channel!(
        "WHERE id = ? AND kind IN ('text', 'voice')"
    ))
    .bind(id)
    .fetch_optional(conn)
    .await?;
    channel.ok_or_else(|| ApiError::NotFound("Nenhum canal com esse id.".into()))
}

/// O nome de um canal de texto, como o `#nome` da lista: sem espaços nas
/// pontas, em minúsculas, espaços viram `-`, e só letras (com acento),
/// números, `-` e `_`. De 1 a 32 caracteres.
pub fn normalize_text_name(input: &str) -> Result<String, ApiError> {
    let name: String = input
        .trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-");
    let ok = (1..=NAME_MAX).contains(&name.chars().count())
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(name)
    } else {
        Err(ApiError::InvalidRequest(
            "Nome de canal: de 1 a 32 letras, números, - ou _.".into(),
        ))
    }
}

/// O nome de uma sala de voz ou de uma categoria: texto livre de 1 a 32
/// caracteres, numa linha só.
pub fn validate_label(input: &str) -> Result<String, ApiError> {
    let name = input.trim();
    let ok = (1..=NAME_MAX).contains(&name.chars().count()) && !name.contains(['\n', '\r']);
    if ok {
        Ok(name.to_owned())
    } else {
        Err(ApiError::InvalidRequest(
            "O nome precisa ter de 1 a 32 caracteres, numa linha só.".into(),
        ))
    }
}

/// O tópico: vazio tira; senão até 120 caracteres, numa linha só.
pub fn normalize_topic(input: &str) -> Result<Option<String>, ApiError> {
    let topic = input.trim();
    if topic.is_empty() {
        return Ok(None);
    }
    if topic.chars().count() > TOPIC_MAX || topic.contains(['\n', '\r']) {
        return Err(ApiError::InvalidRequest(
            "O tópico tem até 120 caracteres, numa linha só.".into(),
        ));
    }
    Ok(Some(topic.to_owned()))
}

/// Quem acessa um canal (ADR 0028): todos, ou só a lista `member_ids` (mais o
/// dono e quem gerencia os canais, que não precisam estar nela).
#[derive(Debug, Clone, Copy)]
pub struct ChannelAccess<'a> {
    pub restricted: bool,
    pub member_ids: &'a [String],
}

/// Os membros ativos de `ids`, sem repetir e em ordem; `InvalidRequest` se
/// algum não existe ou foi removido.
async fn validate_members(
    conn: &mut SqliteConnection,
    ids: &[String],
) -> Result<Vec<String>, ApiError> {
    let mut unique: Vec<String> = ids.to_vec();
    unique.sort();
    unique.dedup();
    for id in &unique {
        let found: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM users WHERE id = ? AND removed_at IS NULL")
                .bind(id)
                .fetch_optional(&mut *conn)
                .await?;
        if found.is_none() {
            return Err(ApiError::InvalidRequest(
                "Alguém da lista de acesso não é membro do grupo.".into(),
            ));
        }
    }
    Ok(unique)
}

/// Os ids na lista do canal `id`, em ordem.
async fn members_of(conn: &mut SqliteConnection, id: &str) -> Result<Vec<String>, ApiError> {
    Ok(sqlx::query_scalar(
        "SELECT user_id FROM channel_members WHERE channel_id = ? ORDER BY user_id",
    )
    .bind(id)
    .fetch_all(conn)
    .await?)
}

/// Grava a restrição e a lista. Sem restrição, a lista é apagada: ela só quer
/// dizer alguma coisa num canal restrito.
async fn write_access(
    conn: &mut SqliteConnection,
    id: &str,
    restricted: bool,
    members: &[String],
) -> Result<(), ApiError> {
    sqlx::query("UPDATE channels SET restricted = ? WHERE id = ?")
        .bind(restricted)
        .bind(id)
        .execute(&mut *conn)
        .await?;
    sqlx::query("DELETE FROM channel_members WHERE channel_id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    if restricted {
        for user_id in members {
            sqlx::query("INSERT INTO channel_members (channel_id, user_id) VALUES (?, ?)")
                .bind(id)
                .bind(user_id)
                .execute(&mut *conn)
                .await?;
        }
    }
    Ok(())
}

/// Cria um canal no fim da categoria (ou do topo, sem categoria): um canal de
/// texto, com o nome `#nome` e o tópico opcional, ou uma sala de voz (v0.5), com
/// o nome livre e sem tópico. Com `access`, já nasce restrito. Devolve o canal e
/// a versão nova.
#[allow(clippy::too_many_arguments)]
pub async fn create(
    db: &SqlitePool,
    actor: &User,
    kind: ChannelKind,
    name: &str,
    category_id: Option<&str>,
    topic: Option<&str>,
    access: Option<ChannelAccess<'_>>,
    now: i64,
) -> Result<(Channel, i64), ApiError> {
    require_permission(db, actor, Permission::ManageChannels).await?;
    let (name, topic) = match kind {
        ChannelKind::Text => (
            normalize_text_name(name)?,
            topic.map(normalize_topic).transpose()?.flatten(),
        ),
        ChannelKind::Voice => {
            if topic.is_some_and(|topic| !topic.trim().is_empty()) {
                return Err(ApiError::InvalidRequest(
                    "Sala de voz não tem tópico.".into(),
                ));
            }
            (validate_label(name)?, None)
        }
    };
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    if let Some(category_id) = category_id {
        layout::require_open_category(&mut tx, category_id).await?;
    }
    let id = Uuid::now_v7().to_string();
    let position = next_position(&mut tx, category_id).await?;
    sqlx::query(
        "INSERT INTO channels (id, kind, name, topic, category_id, position, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(kind)
    .bind(&name)
    .bind(&topic)
    .bind(category_id)
    .bind(position)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    if let Some(access) = access.filter(|access| access.restricted) {
        let members = validate_members(&mut tx, access.member_ids).await?;
        write_access(&mut tx, &id, true, &members).await?;
    }
    let version = layout::bump(&mut tx).await?;
    let channel = get(&mut tx, &id).await?;
    tx.commit().await?;
    Ok((channel, version))
}

/// O que editar num canal. `None` deixa como está; no tópico, texto vazio tira.
#[derive(Debug, Default)]
pub struct ChannelEdit<'a> {
    pub name: Option<&'a str>,
    pub topic: Option<&'a str>,
    /// A restrição e a lista inteira, como devem ficar.
    pub access: Option<ChannelAccess<'a>>,
}

/// Renomeia, troca o tópico ou a lista de acesso de um canal aberto. O nome segue a regra do tipo:
/// `#nome` no de texto, livre na sala de voz. Devolve o canal e a versão nova,
/// ou `None` na versão se nada mudou (o mesmo nome e tópico, ou um pedido vazio):
/// aí ninguém precisa recarregar a lista.
pub async fn update(
    db: &SqlitePool,
    actor: &User,
    id: &str,
    edit: ChannelEdit<'_>,
) -> Result<(Channel, Option<i64>), ApiError> {
    require_permission(db, actor, Permission::ManageChannels).await?;
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    let channel = get(&mut tx, id).await?;
    if channel.archived_at.is_some() {
        return Err(ApiError::Conflict(
            "Esse canal está arquivado: desarquive antes de editar.".into(),
        ));
    }
    let name = match (edit.name, channel.kind) {
        (None, _) => channel.name.clone(),
        (Some(name), ChannelKind::Text) => normalize_text_name(name)?,
        (Some(name), ChannelKind::Voice) => validate_label(name)?,
    };
    let topic = match (edit.topic, channel.kind) {
        (None, _) => channel.topic.clone(),
        (Some(topic), ChannelKind::Voice) if !topic.trim().is_empty() => {
            return Err(ApiError::InvalidRequest(
                "Sala de voz não tem tópico.".into(),
            ));
        }
        (Some(topic), _) => normalize_topic(topic)?,
    };
    let before = members_of(&mut tx, id).await?;
    let (restricted, members) = match edit.access {
        None => (channel.restricted, before.clone()),
        Some(access) if access.restricted => {
            (true, validate_members(&mut tx, access.member_ids).await?)
        }
        Some(_) => (false, Vec::new()),
    };
    let access_changed = restricted != channel.restricted || members != before;
    if name == channel.name && topic == channel.topic && !access_changed {
        return Ok((channel, None));
    }
    sqlx::query("UPDATE channels SET name = ?, topic = ? WHERE id = ?")
        .bind(&name)
        .bind(&topic)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    if access_changed {
        write_access(&mut tx, id, restricted, &members).await?;
    }
    let version = layout::bump(&mut tx).await?;
    let channel = get(&mut tx, id).await?;
    tx.commit().await?;
    Ok((channel, Some(version)))
}

/// Arquiva: some da lista e das rotas de mensagem; as mensagens ficam.
/// Devolve a versão nova, ou `None` se já estava arquivado (repetir não é erro
/// e não muda nada).
pub async fn archive(
    db: &SqlitePool,
    actor: &User,
    id: &str,
    now: i64,
) -> Result<Option<i64>, ApiError> {
    require_permission(db, actor, Permission::ManageChannels).await?;
    if PROTECTED.contains(&id) {
        return Err(ApiError::InvalidRequest(
            "O #geral e a Sala não podem ser arquivados.".into(),
        ));
    }
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    let channel = get(&mut tx, id).await?;
    if channel.archived_at.is_some() {
        return Ok(None);
    }
    sqlx::query("UPDATE channels SET archived_at = ? WHERE id = ?")
        .bind(now)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let version = layout::bump(&mut tx).await?;
    tx.commit().await?;
    Ok(Some(version))
}

/// Desarquiva no fim da categoria em que estava, se ela ainda estiver aberta;
/// senão, no fim do topo. Devolve a versão nova, ou `None` se já estava aberto.
pub async fn unarchive(db: &SqlitePool, actor: &User, id: &str) -> Result<Option<i64>, ApiError> {
    require_permission(db, actor, Permission::ManageChannels).await?;
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    let channel = get(&mut tx, id).await?;
    if channel.archived_at.is_none() {
        return Ok(None);
    }
    let category_id = match channel.category_id.as_deref() {
        Some(category_id) if layout::is_open_category(&mut tx, category_id).await? => {
            Some(category_id.to_owned())
        }
        _ => None,
    };
    let position = next_position(&mut tx, category_id.as_deref()).await?;
    sqlx::query(
        "UPDATE channels SET archived_at = NULL, category_id = ?, position = ? WHERE id = ?",
    )
    .bind(&category_id)
    .bind(position)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    let version = layout::bump(&mut tx).await?;
    tx.commit().await?;
    Ok(Some(version))
}

/// A posição depois do último canal aberto da categoria (ou do topo).
pub(crate) async fn next_position(
    conn: &mut SqliteConnection,
    category_id: Option<&str>,
) -> Result<i64, ApiError> {
    let last: Option<i64> = sqlx::query_scalar(
        "SELECT MAX(position) FROM channels
         WHERE category_id IS ? AND archived_at IS NULL AND kind IN ('text', 'voice')",
    )
    .bind(category_id)
    .fetch_one(conn)
    .await?;
    Ok(last.map_or(0, |last| last + 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nome_de_canal_de_texto() {
        assert_eq!(
            normalize_text_name("  Jogos  Online ").unwrap(),
            "jogos-online"
        );
        assert_eq!(normalize_text_name("anúncios").unwrap(), "anúncios");
        assert_eq!(normalize_text_name("off_topic-2").unwrap(), "off_topic-2");
        for bad in ["", "   ", "com!", "#geral", &"a".repeat(33)] {
            assert!(normalize_text_name(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn nome_livre_de_sala_e_categoria() {
        assert_eq!(validate_label("  Sala do Kid ").unwrap(), "Sala do Kid");
        assert!(validate_label("").is_err());
        assert!(validate_label("duas\nlinhas").is_err());
        assert!(validate_label(&"a".repeat(33)).is_err());
    }

    #[test]
    fn topico() {
        assert_eq!(normalize_topic("  ").unwrap(), None);
        assert_eq!(
            normalize_topic(" Só jogos ").unwrap().as_deref(),
            Some("Só jogos")
        );
        assert!(normalize_topic(&"a".repeat(121)).is_err());
        assert!(normalize_topic("a\nb").is_err());
    }
}
