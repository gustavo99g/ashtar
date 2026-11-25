//! Os arquivos (ADR 0031): a foto de perfil, os anexos do chat, as imagens das prévias de link e os
//! emojis do grupo. Os bytes ficam no [`FileStore`]; a tabela `files` guarda o resto. A API nunca
//! decodifica nem executa o que recebe: só confere a assinatura dos primeiros bytes de imagens e
//! vídeos, para decidir se o arquivo é servido para mostrar ou só para baixar.

pub mod store;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;

pub use store::{FileStore, Upload, valid_id};

use crate::chat::access;
use crate::error::ApiError;
use crate::identity::User;

/// Para que o arquivo serve.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
pub enum FileKind {
    Avatar,
    Attachment,
    /// A imagem de uma prévia de link: quem grava é a própria API.
    Preview,
    Emoji,
    /// Um som do soundboard (v0.9, ADR 0037): o WAV que o editor do app gera.
    Sound,
}

impl FileKind {
    /// O maior arquivo de cada tipo, em bytes, e como o erro diz.
    pub fn max_size(self) -> (u64, &'static str) {
        match self {
            Self::Attachment => (100 * MB, "100 MB"),
            Self::Preview => (5 * MB, "5 MB"),
            // A foto sai do app em 256×256 WebP, e o emoji em 128×128: sobra muito.
            Self::Avatar => (2 * MB, "2 MB"),
            Self::Emoji => (MB, "1 MB"),
            // 5 s de WAV mono 16 bits a 48 kHz dão uns 470 KB.
            Self::Sound => (MB, "1 MB"),
        }
    }
}

const MB: u64 = 1024 * 1024;

/// Com menos que isso livre no disco, a API recusa envios (507).
pub const MIN_FREE_BYTES: u64 = 1024 * MB;
/// Arquivo enviado e não usado nesse tempo (em segundos) é apagado.
pub const UNUSED_TTL_SECS: i64 = 24 * 60 * 60;
/// Passando disso, o dono é avisado (no máximo uma vez por dia).
pub const DISK_ALERT_RATIO: f64 = 0.8;

/// O que o app sabe de um arquivo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS, sqlx::FromRow)]
#[ts(export, export_to = "index.ts")]
pub struct FileView {
    pub id: String,
    pub kind: FileKind,
    pub name: String,
    pub mime: String,
    #[ts(type = "number")]
    pub size: i64,
    #[ts(type = "number | null")]
    pub width: Option<i64>,
    #[ts(type = "number | null")]
    pub height: Option<i64>,
    #[ts(type = "number | null")]
    pub duration_ms: Option<i64>,
    pub thumbnail_id: Option<String>,
}

/// Um arquivo como a API guarda (o [`FileView`] e o que só ela usa).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct FileRecord {
    pub id: String,
    pub uploader_id: String,
    pub kind: FileKind,
    pub name: String,
    pub mime: String,
    pub size: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub thumbnail_id: Option<String>,
    pub created_at: i64,
    pub used_at: Option<i64>,
}

impl FileRecord {
    pub fn view(&self) -> FileView {
        FileView {
            id: self.id.clone(),
            kind: self.kind,
            name: self.name.clone(),
            mime: self.mime.clone(),
            size: self.size,
            width: self.width,
            height: self.height,
            duration_ms: self.duration_ms,
            thumbnail_id: self.thumbnail_id.clone(),
        }
    }

    /// Se o navegador pode mostrar (imagem ou vídeo com a assinatura certa). O resto só baixa.
    pub fn inline(&self) -> bool {
        is_media(&self.mime)
    }
}

/// Os tipos que o app mostra no chat. Só ficam com esse `mime` se os primeiros bytes baterem.
const MEDIA: &[&str] = &[
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "video/mp4",
    "video/webm",
];

/// Os vídeos que o chat toca (o WebView2 toca esses dois).
pub fn is_video(mime: &str) -> bool {
    mime == "video/mp4" || mime == "video/webm"
}

/// HMAC-SHA256 (RFC 2104), sem mais uma dependência só para isso.
fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    const BLOCK: usize = 64;
    let mut block = [0u8; BLOCK];
    if key.len() > BLOCK {
        block[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let mut inner = Sha256::new();
    inner.update(block.map(|b| b ^ 0x36));
    inner.update(message);
    let inner = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(block.map(|b| b ^ 0x5c));
    outer.update(inner);
    outer.finalize().into()
}

/// A assinatura do link curto de `id`, que vale até `expires_at` (decisão 28 do plano da v0.7).
pub fn sign_link(key: &[u8], id: &str, expires_at: i64) -> String {
    hex::encode(hmac_sha256(key, format!("{id}:{expires_at}").as_bytes()))
}

/// Se `sig` é a assinatura de `id` até `expires_at` (comparando em tempo constante).
pub fn link_matches(key: &[u8], id: &str, expires_at: i64, sig: &str) -> bool {
    let expected = sign_link(key, id, expires_at);
    expected.len() == sig.len()
        && expected
            .bytes()
            .zip(sig.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

pub fn is_media(mime: &str) -> bool {
    MEDIA.contains(&mime)
}

/// Se `head` (o começo do arquivo) é mesmo do tipo `mime`.
pub fn signature_matches(mime: &str, head: &[u8]) -> bool {
    match mime {
        "image/png" => head.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => head.starts_with(b"\xff\xd8\xff"),
        "image/gif" => head.starts_with(b"GIF87a") || head.starts_with(b"GIF89a"),
        "image/webp" => head.len() >= 12 && &head[..4] == b"RIFF" && &head[8..12] == b"WEBP",
        "video/mp4" => head.len() >= 8 && &head[4..8] == b"ftyp",
        "video/webm" => head.starts_with(b"\x1a\x45\xdf\xa3"),
        _ => false,
    }
}

/// O tipo que fica guardado: o que o app disse, se for um tipo de mídia com a assinatura certa,
/// ou um tipo comum que não é mídia; senão, `application/octet-stream`.
pub fn settle_mime(claimed: &str, head: &[u8]) -> String {
    let claimed = claimed
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let looks_valid = !claimed.is_empty()
        && claimed.len() <= 100
        && claimed.contains('/')
        && claimed
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"/.+-".contains(&b));
    if !looks_valid {
        return "application/octet-stream".into();
    }
    let risky = claimed.starts_with("image/")
        || claimed.starts_with("video/")
        || claimed.contains("html")
        || claimed.contains("xml")
        || claimed.contains("javascript");
    if is_media(&claimed) {
        if signature_matches(&claimed, head) {
            claimed
        } else {
            "application/octet-stream".into()
        }
    } else if risky {
        // Um SVG, um HTML: nunca para mostrar.
        "application/octet-stream".into()
    } else {
        claimed
    }
}

/// O nome original, sem pastas nem caracteres de controle, com até 255 caracteres.
pub fn clean_name(name: &str) -> Option<String> {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .chars()
        .take(255)
        .collect();
    (!cleaned.is_empty() && cleaned != "." && cleaned != "..").then_some(cleaned)
}

/// O que acompanha um envio.
#[derive(Debug, Clone)]
pub struct NewFile {
    pub id: String,
    pub uploader_id: String,
    pub kind: FileKind,
    pub name: String,
    pub mime: String,
    pub size: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub thumbnail_id: Option<String>,
    pub created_at: i64,
}

pub async fn insert(db: &SqlitePool, file: &NewFile) -> Result<(), ApiError> {
    sqlx::query(
        "INSERT INTO files (id, uploader_id, kind, name, mime, size, width, height, duration_ms,
                            thumbnail_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&file.id)
    .bind(&file.uploader_id)
    .bind(file.kind)
    .bind(&file.name)
    .bind(&file.mime)
    .bind(file.size)
    .bind(file.width)
    .bind(file.height)
    .bind(file.duration_ms)
    .bind(&file.thumbnail_id)
    .bind(file.created_at)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn find(db: &SqlitePool, id: &str) -> Result<Option<FileRecord>, ApiError> {
    Ok(sqlx::query_as("SELECT * FROM files WHERE id = ?")
        .bind(id)
        .fetch_optional(db)
        .await?)
}

/// Marca os arquivos (e as miniaturas deles) como usados: não saem mais na limpeza.
pub async fn mark_used(
    tx: &mut sqlx::SqliteConnection,
    ids: &[String],
    now: i64,
) -> Result<(), ApiError> {
    for id in ids {
        sqlx::query(
            "UPDATE files SET used_at = coalesce(used_at, ?)
             WHERE id = ? OR id = (SELECT thumbnail_id FROM files WHERE id = ?)",
        )
        .bind(now)
        .bind(id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    Ok(())
}

/// Se `user` pode ver `file`: a foto de agora, os emojis, os sons e a imagem das prévias, todo mundo do grupo; o anexo, quem
/// enviou e quem lê o canal de uma das mensagens que o usam. A miniatura vale o que vale o arquivo
/// de que ela é a miniatura.
pub async fn can_read(db: &SqlitePool, user: &User, file: &FileRecord) -> Result<bool, ApiError> {
    // A imagem de uma prévia veio de um site público: quem está no grupo vê.
    // O som, aguardando ou aprovado, também: quem aprova precisa ouvir antes.
    if matches!(
        file.kind,
        FileKind::Emoji | FileKind::Preview | FileKind::Sound
    ) || file.uploader_id == user.id
    {
        return Ok(true);
    }
    // A foto de perfil, só a de agora: as guardadas para voltar a elas são só de quem enviou.
    if file.kind == FileKind::Avatar {
        let current: Option<i64> = sqlx::query_scalar("SELECT 1 FROM users WHERE avatar_id = ?")
            .bind(&file.id)
            .fetch_optional(db)
            .await?;
        return Ok(current.is_some());
    }
    let channels: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT m.channel_id
         FROM message_files mf JOIN messages m ON m.id = mf.message_id
         WHERE mf.file_id = ?1
            OR mf.file_id IN (SELECT id FROM files WHERE thumbnail_id = ?1)",
    )
    .bind(&file.id)
    .fetch_all(db)
    .await?;
    for channel_id in channels {
        if access::readable(db, user, &channel_id).await.is_ok() {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Solta os arquivos `ids`, que uma mensagem excluída usava: os que nenhuma outra mensagem usa
/// saem da tabela, com a miniatura. Devolve os ids que saíram, para quem chama apagar os bytes
/// depois da transação.
pub async fn release(
    tx: &mut sqlx::SqliteConnection,
    ids: &[String],
) -> Result<Vec<String>, ApiError> {
    let mut gone = Vec::new();
    for id in ids {
        let still_used: bool =
            sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM message_files WHERE file_id = ?)")
                .bind(id)
                .fetch_one(&mut *tx)
                .await?;
        if still_used {
            continue;
        }
        let thumbnail: Option<String> =
            sqlx::query_scalar("SELECT thumbnail_id FROM files WHERE id = ?")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?
                .flatten();
        sqlx::query("DELETE FROM files WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        gone.push(id.clone());
        if let Some(thumbnail) = thumbnail {
            let shared: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM files WHERE thumbnail_id = ?)
                     OR EXISTS (SELECT 1 FROM message_files WHERE file_id = ?)",
            )
            .bind(&thumbnail)
            .bind(&thumbnail)
            .fetch_one(&mut *tx)
            .await?;
            if !shared {
                sqlx::query("DELETE FROM files WHERE id = ?")
                    .bind(&thumbnail)
                    .execute(&mut *tx)
                    .await?;
                gone.push(thumbnail);
            }
        }
    }
    Ok(gone)
}

/// Os arquivos enviados há mais de 24 horas e nunca usados: sai a linha, e quem chama apaga os
/// bytes. Uma miniatura de um arquivo usado nunca entra aqui (o [`mark_used`] marca as duas).
pub async fn take_unused(db: &SqlitePool, now: i64) -> Result<Vec<String>, ApiError> {
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM files f
         WHERE used_at IS NULL AND created_at < ?
           AND NOT EXISTS (SELECT 1 FROM files p WHERE p.thumbnail_id = f.id AND p.used_at IS NOT NULL)",
    )
    .bind(now - UNUSED_TTL_SECS)
    .fetch_all(&mut *tx)
    .await?;
    for id in &ids {
        // A miniatura sai antes de quem aponta para ela: tira o ponteiro.
        sqlx::query("UPDATE files SET thumbnail_id = NULL WHERE thumbnail_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    for id in &ids {
        sqlx::query("DELETE FROM files WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(ids)
}

/// Quanto os arquivos ocupam, em bytes.
pub async fn total_size(db: &SqlitePool) -> Result<i64, ApiError> {
    Ok(
        sqlx::query_scalar("SELECT coalesce(sum(size), 0) FROM files")
            .fetch_one(db)
            .await?,
    )
}

/// A limpeza: apaga os arquivos não usados (a linha e os bytes). Devolve quantos saíram.
pub async fn sweep(db: &SqlitePool, store: &FileStore, now: i64) -> Result<usize, ApiError> {
    let ids = take_unused(db, now).await?;
    for id in &ids {
        if let Err(error) = store.delete(id).await {
            eprintln!("arquivo {id}: não deu para apagar do disco: {error}");
        }
    }
    Ok(ids.len())
}

/// Se o disco passou de 80% e o dono não foi avisado nas últimas 24 horas, o aviso a mandar.
/// `last` é quando foi o último; quem chama guarda o `now` se mandar.
pub fn disk_alert(free_bytes: u64, total_bytes: u64, last: i64, now: i64) -> bool {
    if total_bytes == 0 || now - last < 24 * 60 * 60 {
        return false;
    }
    let used = total_bytes.saturating_sub(free_bytes) as f64 / total_bytes as f64;
    used > DISK_ALERT_RATIO
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn o_hmac_bate_com_a_rfc_4231() {
        // Caso 2 da RFC 4231.
        assert_eq!(
            hex::encode(hmac_sha256(b"Jefe", b"what do ya want for nothing?")),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
        let key = [7u8; 32];
        let sig = sign_link(&key, "f1", 100);
        assert!(link_matches(&key, "f1", 100, &sig));
        assert!(!link_matches(&key, "f2", 100, &sig));
        assert!(!link_matches(&key, "f1", 101, &sig));
        assert!(!link_matches(&[8u8; 32], "f1", 100, &sig));
    }

    #[test]
    fn o_aviso_do_disco_so_uma_vez_por_dia() {
        let day = 24 * 60 * 60;
        assert!(disk_alert(10, 100, 0, day));
        assert!(!disk_alert(30, 100, 0, day));
        assert!(!disk_alert(10, 100, day, day + 3600));
        assert!(disk_alert(10, 100, day, 2 * day));
    }

    #[test]
    fn a_imagem_so_fica_imagem_com_a_assinatura_certa() {
        let png = b"\x89PNG\r\n\x1a\n....";
        assert_eq!(settle_mime("image/png", png), "image/png");
        assert_eq!(
            settle_mime("image/png", b"MZ\x90\x00"),
            "application/octet-stream"
        );
        assert_eq!(settle_mime("IMAGE/PNG; x=1", png), "image/png");
        assert_eq!(
            settle_mime("image/svg+xml", b"<svg"),
            "application/octet-stream"
        );
        assert_eq!(
            settle_mime("text/html", b"<html"),
            "application/octet-stream"
        );
        assert_eq!(settle_mime("application/pdf", b"%PDF"), "application/pdf");
        assert_eq!(settle_mime("", b""), "application/octet-stream");
        assert_eq!(
            settle_mime("video/mp4", b"\x00\x00\x00\x18ftypmp42"),
            "video/mp4"
        );
        assert_eq!(
            settle_mime("image/webp", b"RIFF\x00\x00\x00\x00WEBPVP8 "),
            "image/webp"
        );
    }

    #[test]
    fn o_nome_perde_as_pastas() {
        assert_eq!(
            clean_name("C:\\fotos\\praia.png").as_deref(),
            Some("praia.png")
        );
        assert_eq!(clean_name("../../etc/passwd").as_deref(), Some("passwd"));
        assert_eq!(clean_name("  "), None);
        assert_eq!(clean_name(".."), None);
        assert_eq!(clean_name(&"a".repeat(300)).unwrap().len(), 255);
    }
}
