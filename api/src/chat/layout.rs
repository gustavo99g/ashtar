//! A lista de canais como o app desenha: o topo (canais sem categoria) e as
//! categorias, cada uma com os seus canais, com a versão da lista.
//!
//! A versão mora em `channel_layout` e soma 1 a cada mudança. Reordenar
//! ([`apply`]) manda a versão que o app viu; se ela já mudou, a resposta é 409 e
//! o app recarrega a lista em vez de desfazer o que outra pessoa fez.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqliteConnection, SqlitePool};
use ts_rs::TS;

use super::access;
use super::channels::{Channel, ChannelView, select_channel};
use crate::error::ApiError;
use crate::identity::User;
use crate::identity::permissions::{Permission, require_permission};

/// Uma categoria como o banco guarda.
#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub position: i64,
    pub created_at: i64,
    pub archived_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct CategoryView {
    pub id: String,
    pub name: String,
    /// Os canais abertos da categoria, na ordem da lista.
    pub channels: Vec<ChannelView>,
}

/// `GET /api/channels`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct Layout {
    pub version: i64,
    /// Os canais fora de categoria, que aparecem antes de todas.
    pub top: Vec<ChannelView>,
    pub categories: Vec<CategoryView>,
}

/// Uma categoria arquivada, como a tela de arquivados mostra.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct ArchivedCategory {
    pub id: String,
    pub name: String,
    pub archived_at: i64,
}

/// `GET /api/channels/archived`: do arquivado mais recente para o mais antigo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct Archived {
    pub channels: Vec<ChannelView>,
    pub categories: Vec<ArchivedCategory>,
}

/// Uma categoria no pedido de reordenar: o id e os ids dos canais, em ordem.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct CategoryOrder {
    pub id: String,
    pub channels: Vec<String>,
}

/// `PUT /api/channels/layout`: a lista inteira na ordem nova.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct LayoutRequest {
    /// A versão da lista que o app tinha quando a pessoa arrastou.
    pub version: i64,
    pub top: Vec<String>,
    pub categories: Vec<CategoryOrder>,
}

macro_rules! select_category {
    ($rest:literal) => {
        concat!(
            "SELECT id, name, position, created_at, archived_at FROM categories ",
            $rest
        )
    };
}
pub(crate) use select_category;

/// Soma 1 na versão e devolve a nova. Chame dentro da transação da mudança.
pub async fn bump(conn: &mut SqliteConnection) -> Result<i64, ApiError> {
    Ok(
        sqlx::query_scalar("UPDATE channel_layout SET version = version + 1 RETURNING version")
            .fetch_one(conn)
            .await?,
    )
}

/// Soma 1 na versão sem mudar a lista: o que cada um vê dela mudou (alguém
/// ganhou ou perdeu "Gerenciar canais", ADR 0028), e os apps precisam recarregar.
pub async fn touch(db: &SqlitePool) -> Result<i64, ApiError> {
    let mut conn = db.acquire().await?;
    bump(&mut conn).await
}

pub async fn version(conn: &mut SqliteConnection) -> Result<i64, ApiError> {
    Ok(sqlx::query_scalar("SELECT version FROM channel_layout")
        .fetch_one(conn)
        .await?)
}

pub async fn is_open_category(conn: &mut SqliteConnection, id: &str) -> Result<bool, ApiError> {
    let found: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM categories WHERE id = ? AND archived_at IS NULL")
            .bind(id)
            .fetch_optional(conn)
            .await?;
    Ok(found.is_some())
}

/// `NotFound` se a categoria não existe ou está arquivada.
pub async fn require_open_category(conn: &mut SqliteConnection, id: &str) -> Result<(), ApiError> {
    if is_open_category(conn, id).await? {
        Ok(())
    } else {
        Err(ApiError::NotFound(
            "Essa categoria não existe ou foi arquivada.".into(),
        ))
    }
}

/// A lista aberta como `viewer` a vê: o topo e as categorias, cada coisa na sua
/// ordem. Um canal restrito de que ele não faz parte não aparece, e a categoria
/// em que ele não vê nenhum dos canais some junto (ADR 0028). Quem gerencia os
/// canais vê todos. Cada restrito vem com a lista dele, que quem o vê já pode
/// saber: é o que a sugestão do @ e o "Mover para" usam.
///
/// As leituras vão numa transação só: no SQLite, ela vê o banco de um
/// momento só, e a versão devolvida é sempre a da lista devolvida. Sem isso,
/// uma mudança entre as leituras daria a versão nova com a lista velha, e o
/// próximo arrasto do app levaria 422 em vez do 409 que o faz recarregar.
pub async fn read(db: &SqlitePool, viewer: &User) -> Result<Layout, ApiError> {
    let manages = access::manages_channels(db, viewer).await?;
    let mut conn = db.begin().await?;
    let version = version(&mut conn).await?;
    let categories: Vec<Category> = sqlx::query_as(select_category!(
        "WHERE archived_at IS NULL ORDER BY position, created_at"
    ))
    .fetch_all(&mut *conn)
    .await?;
    let channels: Vec<Channel> = sqlx::query_as(select_channel!(
        "WHERE archived_at IS NULL AND kind IN ('text', 'voice') ORDER BY position, created_at"
    ))
    .fetch_all(&mut *conn)
    .await?;
    let listed: Vec<(String, String)> = sqlx::query_as(
        "SELECT cm.channel_id, cm.user_id FROM channel_members cm
         JOIN channels c ON c.id = cm.channel_id
         WHERE c.restricted = 1 AND c.kind IN ('text', 'voice') ORDER BY cm.user_id",
    )
    .fetch_all(&mut *conn)
    .await?;
    let members_of = |channel_id: &str| -> Vec<String> {
        listed
            .iter()
            .filter(|(c, _)| c == channel_id)
            .map(|(_, u)| u.clone())
            .collect()
    };

    let mut top = Vec::new();
    let mut views: Vec<CategoryView> = categories
        .into_iter()
        .map(|category| CategoryView {
            id: category.id,
            name: category.name,
            channels: Vec::new(),
        })
        .collect();
    // As categorias que tinham algum canal antes de tirar os que a pessoa não vê.
    let mut had_channels: HashSet<String> = HashSet::new();
    for channel in channels {
        if let Some(category_id) = &channel.category_id {
            had_channels.insert(category_id.clone());
        }
        let members = channel.restricted.then(|| members_of(&channel.id));
        if let Some(members) = &members
            && !manages
            && !members.contains(&viewer.id)
        {
            continue;
        }
        let mut view = ChannelView::from(channel);
        view.member_ids = members;
        // Um canal numa categoria arquivada (não deveria acontecer: arquivar a
        // categoria leva os canais para o topo) aparece no topo.
        let category = view
            .category_id
            .as_deref()
            .and_then(|id| views.iter_mut().find(|c| c.id == id));
        match category {
            Some(category) => category.channels.push(view),
            None => top.push(ChannelView {
                category_id: None,
                ..view
            }),
        }
    }
    conn.commit().await?;
    if !manages {
        views.retain(|c| !c.channels.is_empty() || !had_channels.contains(&c.id));
    }
    Ok(Layout {
        version,
        top,
        categories: views,
    })
}

/// O que está arquivado: só para quem gerencia os canais.
pub async fn read_archived(db: &SqlitePool, actor: &User) -> Result<Archived, ApiError> {
    require_permission(db, actor, Permission::ManageChannels).await?;
    let channels: Vec<Channel> = sqlx::query_as(select_channel!(
        "WHERE archived_at IS NOT NULL AND kind IN ('text', 'voice') ORDER BY archived_at DESC"
    ))
    .fetch_all(db)
    .await?;
    let categories: Vec<Category> = sqlx::query_as(select_category!(
        "WHERE archived_at IS NOT NULL ORDER BY archived_at DESC"
    ))
    .fetch_all(db)
    .await?;
    Ok(Archived {
        channels: channels.into_iter().map(ChannelView::from).collect(),
        categories: categories
            .into_iter()
            .filter_map(|c| {
                Some(ArchivedCategory {
                    archived_at: c.archived_at?,
                    id: c.id,
                    name: c.name,
                })
            })
            .collect(),
    })
}

/// Grava a ordem nova. O pedido precisa ter exatamente os canais e as
/// categorias abertos, cada um uma vez: um canal que faltasse ficaria sem
/// lugar. Só para quem gerencia os canais.
pub async fn apply(
    db: &SqlitePool,
    actor: &User,
    request: &LayoutRequest,
) -> Result<Layout, ApiError> {
    require_permission(db, actor, Permission::ManageChannels).await?;
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    if version(&mut tx).await? != request.version {
        return Err(ApiError::Conflict(
            "A lista de canais mudou enquanto você arrastava. Confira e tente de novo.".into(),
        ));
    }

    let open_channels: HashSet<String> = sqlx::query_scalar(
        "SELECT id FROM channels WHERE archived_at IS NULL AND kind IN ('text', 'voice')",
    )
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .collect();
    let open_categories: HashSet<String> =
        sqlx::query_scalar("SELECT id FROM categories WHERE archived_at IS NULL")
            .fetch_all(&mut *tx)
            .await?
            .into_iter()
            .collect();

    let sent_channels: Vec<&String> = request
        .top
        .iter()
        .chain(request.categories.iter().flat_map(|c| &c.channels))
        .collect();
    let sent_categories: Vec<&String> = request.categories.iter().map(|c| &c.id).collect();
    if !same_set(&sent_channels, &open_channels) || !same_set(&sent_categories, &open_categories) {
        return Err(ApiError::InvalidRequest(
            "O pedido precisa ter todos os canais e categorias abertos, uma vez cada.".into(),
        ));
    }

    for (position, id) in request.top.iter().enumerate() {
        place_channel(&mut tx, id, None, position).await?;
    }
    for (position, category) in request.categories.iter().enumerate() {
        sqlx::query("UPDATE categories SET position = ? WHERE id = ?")
            .bind(position as i64)
            .bind(&category.id)
            .execute(&mut *tx)
            .await?;
        for (position, id) in category.channels.iter().enumerate() {
            place_channel(&mut tx, id, Some(&category.id), position).await?;
        }
    }
    bump(&mut tx).await?;
    tx.commit().await?;
    read(db, actor).await
}

fn same_set(sent: &[&String], open: &HashSet<String>) -> bool {
    let unique: HashSet<&String> = sent.iter().copied().collect();
    unique.len() == sent.len()
        && unique.len() == open.len()
        && unique.iter().all(|id| open.contains(*id))
}

async fn place_channel(
    conn: &mut SqliteConnection,
    id: &str,
    category_id: Option<&str>,
    position: usize,
) -> Result<(), ApiError> {
    sqlx::query("UPDATE channels SET category_id = ?, position = ? WHERE id = ?")
        .bind(category_id)
        .bind(position as i64)
        .bind(id)
        .execute(conn)
        .await?;
    Ok(())
}
