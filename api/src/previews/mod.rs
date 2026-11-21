//! A prévia de links (decisões 22 e 23 do plano da v0.7): quando a mensagem tem links, a API busca
//! as páginas em segundo plano, guarda o site, o título, a descrição e a imagem, e manda um
//! `message.updated` com os cartões. A imagem é baixada pela API e guardada como arquivo
//! (`preview`), para o IP de ninguém do grupo ir para o site.
//!
//! O resultado de cada endereço fica num cache de 24 horas (`link_previews`): o mesmo link mandado
//! de novo não busca de novo. Uma página sem prévia também fica no cache, para não insistir.

pub mod guard;
pub mod meta;

use std::net::IpAddr;

use reqwest::Url;
use serde::Serialize;
use sqlx::SqlitePool;
use ts_rs::TS;
use uuid::Uuid;

pub use guard::Guard;

use crate::error::ApiError;
use crate::files::{self, FileKind, FileStore, NewFile};

/// Quanto tempo o cache de um endereço vale, em segundos.
pub const CACHE_SECS: i64 = 24 * 60 * 60;
/// O começo da página que é lido.
pub const HTML_MAX: usize = 512 * 1024;
/// A maior imagem de prévia.
pub const IMAGE_MAX: usize = 2 * 1024 * 1024;

/// O cartão de um link, como a `Message` leva.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS, sqlx::FromRow)]
#[ts(export, export_to = "index.ts")]
pub struct LinkPreview {
    /// O endereço como estava na mensagem.
    pub url: String,
    pub site: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    /// O arquivo da imagem (`kind = preview`), se a página tem uma.
    pub image_id: Option<String>,
}

fn is_html(content_type: &str) -> bool {
    content_type == "text/html" || content_type == "application/xhtml+xml"
}

fn is_image(content_type: &str) -> bool {
    matches!(
        content_type,
        "image/png" | "image/jpeg" | "image/gif" | "image/webp"
    )
}

/// Os endereços da própria VPS, pelo nome do `PUBLIC_URL`: a prévia nunca vai até ela.
pub async fn own_addresses(public_url: &str) -> Vec<IpAddr> {
    let Ok(url) = Url::parse(public_url) else {
        return Vec::new();
    };
    let (Some(host), Some(port)) = (url.host_str(), url.port_or_known_default()) else {
        return Vec::new();
    };
    match tokio::net::lookup_host((host, port)).await {
        Ok(addrs) => addrs.map(|a| a.ip()).collect(),
        Err(_) => Vec::new(),
    }
}

/// Busca a página `url` e a imagem dela. `None`: a página não deu prévia (recusada, fora do ar,
/// sem título).
async fn fetch(
    db: &SqlitePool,
    store: &FileStore,
    guard: &Guard,
    url: &Url,
    uploader_id: &str,
    now: i64,
) -> Result<Option<LinkPreview>, ApiError> {
    let (page, _, body) = match guard.get(url.clone(), is_html, HTML_MAX, true).await {
        Ok(found) => found,
        Err(refused) => {
            eprintln!("prévia de {url}: {refused}");
            return Ok(None);
        }
    };
    let html = String::from_utf8_lossy(&body);
    let found = meta::parse(&html, &page);
    if found.title.is_none() && found.description.is_none() {
        return Ok(None);
    }
    let image_id = match &found.image {
        Some(image) => save_image(db, store, guard, image, uploader_id, now).await?,
        None => None,
    };
    Ok(Some(LinkPreview {
        url: url.to_string(),
        site: found.site,
        title: found.title,
        description: found.description,
        image_id,
    }))
}

/// Baixa a imagem da prévia e guarda como arquivo `preview`, já usado (a limpeza não leva).
async fn save_image(
    db: &SqlitePool,
    store: &FileStore,
    guard: &Guard,
    image: &Url,
    uploader_id: &str,
    now: i64,
) -> Result<Option<String>, ApiError> {
    let (_, content_type, bytes) = match guard.get(image.clone(), is_image, IMAGE_MAX, false).await
    {
        Ok(found) => found,
        Err(refused) => {
            eprintln!("imagem da prévia {image}: {refused}");
            return Ok(None);
        }
    };
    // A API não decodifica: só confere a assinatura, como no envio.
    if !files::signature_matches(&content_type, &bytes) {
        return Ok(None);
    }
    let id = Uuid::now_v7().to_string();
    let mut upload = store.put(&id).await?;
    upload.write(&bytes).await?;
    upload.finish().await?;
    files::insert(
        db,
        &NewFile {
            id: id.clone(),
            uploader_id: uploader_id.to_owned(),
            kind: FileKind::Preview,
            name: "previa".into(),
            mime: content_type,
            size: bytes.len() as i64,
            width: None,
            height: None,
            duration_ms: None,
            thumbnail_id: None,
            created_at: now,
        },
    )
    .await?;
    sqlx::query("UPDATE files SET used_at = ? WHERE id = ?")
        .bind(now)
        .bind(&id)
        .execute(db)
        .await?;
    Ok(Some(id))
}

#[derive(sqlx::FromRow)]
struct Cached {
    ok: bool,
    fetched_at: i64,
    image_id: Option<String>,
}

/// A prévia de `url`: do cache, se tem menos de 24 horas; senão, busca e guarda.
async fn preview_of(
    db: &SqlitePool,
    store: &FileStore,
    guard: &Guard,
    url: &Url,
    uploader_id: &str,
    now: i64,
) -> Result<bool, ApiError> {
    let key = url.to_string();
    let cached: Option<Cached> =
        sqlx::query_as("SELECT ok, fetched_at, image_id FROM link_previews WHERE url = ?")
            .bind(&key)
            .fetch_optional(db)
            .await?;
    if let Some(cached) = &cached
        && now - cached.fetched_at < CACHE_SECS
    {
        return Ok(cached.ok);
    }
    let found = fetch(db, store, guard, url, uploader_id, now).await?;
    let row = found.unwrap_or(LinkPreview {
        url: key.clone(),
        site: None,
        title: None,
        description: None,
        image_id: None,
    });
    let ok = row.title.is_some() || row.description.is_some();
    sqlx::query(
        "INSERT INTO link_previews (url, site, title, description, image_id, fetched_at, ok)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (url) DO UPDATE SET site = excluded.site, title = excluded.title,
             description = excluded.description, image_id = excluded.image_id,
             fetched_at = excluded.fetched_at, ok = excluded.ok",
    )
    .bind(&key)
    .bind(&row.site)
    .bind(&row.title)
    .bind(&row.description)
    .bind(&row.image_id)
    .bind(now)
    .bind(ok)
    .execute(db)
    .await?;
    // A imagem antiga do mesmo endereço sai.
    if let Some(old) = cached.and_then(|c| c.image_id)
        && Some(&old) != row.image_id.as_ref()
    {
        sqlx::query("DELETE FROM files WHERE id = ?")
            .bind(&old)
            .execute(db)
            .await?;
        let _ = store.delete(&old).await;
    }
    Ok(ok)
}

/// Refaz as prévias da mensagem `message_id` a partir do texto dela. Devolve se mudou (aí quem
/// chama manda o `message.updated`). O autor que tirou as prévias (`previews_hidden`) não ganha
/// de novo.
pub async fn refresh(
    db: &SqlitePool,
    store: &FileStore,
    guard: &Guard,
    message_id: &str,
    now: i64,
) -> Result<bool, ApiError> {
    let row: Option<(String, String, bool)> =
        sqlx::query_as("SELECT body, author_id, previews_hidden FROM messages WHERE id = ?")
            .bind(message_id)
            .fetch_optional(db)
            .await?;
    let Some((body, author_id, hidden)) = row else {
        return Ok(false);
    };
    let before: Vec<String> = sqlx::query_scalar(
        "SELECT url FROM message_previews WHERE message_id = ? ORDER BY position",
    )
    .bind(message_id)
    .fetch_all(db)
    .await?;
    let mut after = Vec::new();
    if !hidden {
        for url in meta::links(&body) {
            if preview_of(db, store, guard, &url, &author_id, now).await? {
                after.push(url.to_string());
            }
        }
    }
    if after == before {
        return Ok(false);
    }
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    // A mensagem pode ter sido excluída enquanto as páginas eram buscadas.
    let exists: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM messages WHERE id = ?)")
        .bind(message_id)
        .fetch_one(&mut *tx)
        .await?;
    if !exists {
        return Ok(false);
    }
    sqlx::query("DELETE FROM message_previews WHERE message_id = ?")
        .bind(message_id)
        .execute(&mut *tx)
        .await?;
    for (position, url) in after.iter().enumerate() {
        sqlx::query("INSERT INTO message_previews (message_id, url, position) VALUES (?, ?, ?)")
            .bind(message_id)
            .bind(url)
            .bind(position as i64)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(true)
}

/// Tira as prévias da mensagem, de vez (o X do autor no cartão).
pub async fn hide(db: &SqlitePool, message_id: &str) -> Result<(), ApiError> {
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    sqlx::query("UPDATE messages SET previews_hidden = 1 WHERE id = ?")
        .bind(message_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM message_previews WHERE message_id = ?")
        .bind(message_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

/// As prévias das mensagens `ids`, na ordem dos links: `(id da mensagem, prévia)`.
pub async fn of_messages(
    db: &SqlitePool,
    ids: &[&str],
) -> Result<Vec<(String, LinkPreview)>, ApiError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut query = sqlx::QueryBuilder::new(
        "SELECT mp.message_id, p.url, p.site, p.title, p.description, p.image_id
         FROM message_previews mp JOIN link_previews p ON p.url = mp.url
         WHERE mp.message_id IN (",
    );
    let mut list = query.separated(", ");
    for id in ids {
        list.push_bind(*id);
    }
    query.push(") ORDER BY mp.position");
    let rows: Vec<PreviewRow> = query.build_query_as().fetch_all(db).await?;
    Ok(rows
        .into_iter()
        .map(|r| (r.message_id, r.preview))
        .collect())
}

#[derive(sqlx::FromRow)]
struct PreviewRow {
    message_id: String,
    #[sqlx(flatten)]
    preview: LinkPreview,
}

/// Esquece as páginas do cache que nenhuma mensagem usa há mais de uma semana, com a imagem.
pub async fn sweep(db: &SqlitePool, store: &FileStore, now: i64) -> Result<usize, ApiError> {
    let old: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT url, image_id FROM link_previews p
         WHERE fetched_at < ?
           AND NOT EXISTS (SELECT 1 FROM message_previews mp WHERE mp.url = p.url)",
    )
    .bind(now - 7 * CACHE_SECS)
    .fetch_all(db)
    .await?;
    for (url, image) in &old {
        sqlx::query("DELETE FROM link_previews WHERE url = ?")
            .bind(url)
            .execute(db)
            .await?;
        if let Some(image) = image {
            sqlx::query("DELETE FROM files WHERE id = ?")
                .bind(image)
                .execute(db)
                .await?;
            let _ = store.delete(image).await;
        }
    }
    Ok(old.len())
}
