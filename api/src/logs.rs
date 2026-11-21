//! Os logs que os membros mandam (v0.6, decisões 16 e 17): o `.zip` que o app junta vai para
//! `{data}/logs/{id}.zip`, com uma linha em `log_reports`. Só o dono lista e baixa. Os de mais de
//! 30 dias saem junto do backup (`admin backup`).

use std::path::{Path, PathBuf};

use serde::Serialize;
use sqlx::SqlitePool;
use ts_rs::TS;

use crate::error::ApiError;

/// O maior `.zip` aceito.
pub const MAX_SIZE: usize = 10 * 1024 * 1024;
/// Um envio por pessoa a cada este tempo, em segundos.
pub const MIN_GAP_SECS: i64 = 5 * 60;
/// Quanto um envio fica guardado, em segundos.
pub const KEEP_SECS: i64 = 30 * 24 * 60 * 60;
/// O maior texto do "O que aconteceu?".
pub const MAX_NOTE: usize = 1000;

/// Um envio, como o Painel mostra.
#[derive(Debug, Clone, Serialize, TS, sqlx::FromRow)]
#[ts(export, export_to = "index.ts")]
pub struct LogReportView {
    pub id: String,
    pub user_id: String,
    pub nick: String,
    pub display_name: Option<String>,
    #[ts(type = "number")]
    pub created_at: i64,
    pub app_version: String,
    pub note: Option<String>,
    #[ts(type = "number")]
    pub size: i64,
}

/// A pasta dos dados (o banco, os backups e os logs): `DATA_DIR`, ou a pasta do banco do
/// `DATABASE_URL`, ou a atual.
pub fn data_dir_from_env() -> PathBuf {
    if let Ok(dir) = std::env::var("DATA_DIR")
        && !dir.trim().is_empty()
    {
        return PathBuf::from(dir);
    }
    std::env::var("DATABASE_URL")
        .ok()
        .and_then(|url| database_dir(&url))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// A pasta do arquivo de um `sqlite://...`: `sqlite:///data/ashtar.db?mode=rwc` dá `/data`.
fn database_dir(url: &str) -> Option<PathBuf> {
    let rest = url.strip_prefix("sqlite:")?;
    let rest = rest.strip_prefix("//").unwrap_or(rest);
    let path = rest.split('?').next()?;
    if path.is_empty() || path.starts_with(":memory:") {
        return None;
    }
    let parent = Path::new(path).parent()?;
    Some(if parent.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        parent.to_path_buf()
    })
}

pub fn logs_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("logs")
}

fn file_of(data_dir: &Path, id: &str) -> PathBuf {
    logs_dir(data_dir).join(format!("{id}.zip"))
}

/// Se `bytes` parece um `.zip` (a assinatura do começo).
pub fn is_zip(bytes: &[u8]) -> bool {
    bytes.starts_with(b"PK\x03\x04")
}

/// O último envio de `user_id`, para o limite de frequência.
pub async fn last_sent(db: &SqlitePool, user_id: &str) -> Result<Option<i64>, ApiError> {
    Ok(
        sqlx::query_scalar("SELECT MAX(created_at) FROM log_reports WHERE user_id = ?")
            .bind(user_id)
            .fetch_one(db)
            .await?,
    )
}

/// Grava o arquivo e a linha. O arquivo vai antes: uma linha sem arquivo seria um Baixar quebrado.
pub async fn save(
    db: &SqlitePool,
    data_dir: &Path,
    user_id: &str,
    app_version: &str,
    note: Option<&str>,
    bytes: &[u8],
    now: i64,
) -> Result<String, ApiError> {
    let id = uuid::Uuid::now_v7().to_string();
    let dir = logs_dir(data_dir);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| ApiError::Config(format!("não foi possível criar {}: {e}", dir.display())))?;
    let file = file_of(data_dir, &id);
    tokio::fs::write(&file, bytes).await.map_err(|e| {
        ApiError::Config(format!("não foi possível gravar {}: {e}", file.display()))
    })?;
    let inserted = sqlx::query(
        "INSERT INTO log_reports (id, user_id, created_at, app_version, note, size) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(user_id)
    .bind(now)
    .bind(app_version)
    .bind(note)
    .bind(bytes.len() as i64)
    .execute(db)
    .await;
    if let Err(error) = inserted {
        let _ = tokio::fs::remove_file(&file).await;
        return Err(error.into());
    }
    Ok(id)
}

/// O `SELECT` de um envio com quem mandou, mais o resto da consulta.
macro_rules! select_report {
    ($rest:literal) => {
        concat!(
            "SELECT r.id, r.user_id, u.nick, u.display_name, r.created_at, r.app_version, r.note, r.size ",
            "FROM log_reports r JOIN users u ON u.id = r.user_id ",
            $rest
        )
    };
}

/// Os envios, do mais novo para o mais antigo.
pub async fn list(db: &SqlitePool) -> Result<Vec<LogReportView>, ApiError> {
    Ok(
        sqlx::query_as(select_report!("ORDER BY r.created_at DESC, r.id DESC"))
            .fetch_all(db)
            .await?,
    )
}

pub async fn find(db: &SqlitePool, id: &str) -> Result<Option<LogReportView>, ApiError> {
    Ok(sqlx::query_as(select_report!("WHERE r.id = ?"))
        .bind(id)
        .fetch_optional(db)
        .await?)
}

/// Um arquivo de dentro do `.zip` de um envio.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct LogEntry {
    pub name: String,
    /// O tamanho descompactado, em bytes.
    #[ts(type = "number")]
    pub size: u64,
}

/// O texto de um arquivo do `.zip`, para ler no app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct LogText {
    pub name: String,
    pub text: String,
    /// Se o arquivo passava de [`TEXT_MAX`] e veio só o fim dele.
    pub truncated: bool,
}

/// O maior texto que o app recebe de um arquivo: de um log maior, vai o fim (o mais recente).
pub const TEXT_MAX: usize = 2 * 1024 * 1024;

fn open_zip(bytes: &[u8]) -> Result<zip::ZipArchive<std::io::Cursor<&[u8]>>, ApiError> {
    zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|_| ApiError::InvalidRequest("O .zip desses logs está estragado.".into()))
}

/// Os arquivos do `.zip`, na ordem em que estão nele (as pastas ficam de fora).
pub fn entries(bytes: &[u8]) -> Result<Vec<LogEntry>, ApiError> {
    let mut archive = open_zip(bytes)?;
    let mut found = Vec::new();
    for index in 0..archive.len() {
        let Ok(file) = archive.by_index(index) else {
            continue;
        };
        let Ok(name) = file.name() else {
            continue;
        };
        if file.is_dir() {
            continue;
        }
        found.push(LogEntry {
            name: name.into_owned(),
            size: file.size(),
        });
    }
    Ok(found)
}

/// O texto do arquivo `name` do `.zip` (UTF-8, com o que não for trocado por �), ou `None` se não
/// há um com esse nome. De um arquivo maior que [`TEXT_MAX`], só o fim.
pub fn entry_text(bytes: &[u8], name: &str) -> Result<Option<LogText>, ApiError> {
    use std::io::Read;
    let mut archive = open_zip(bytes)?;
    let Ok(file) = archive.by_name(name) else {
        return Ok(None);
    };
    if file.is_dir() {
        return Ok(None);
    }
    // O `.zip` passou pelo limite de 10 MB no envio, mas descompactado pode ser maior: lê até um
    // teto, e guarda só o fim.
    let mut content = Vec::new();
    file.take(64 * 1024 * 1024)
        .read_to_end(&mut content)
        .map_err(|_| ApiError::InvalidRequest("O .zip desses logs está estragado.".into()))?;
    let truncated = content.len() > TEXT_MAX;
    let start = content.len().saturating_sub(TEXT_MAX);
    let text = String::from_utf8_lossy(&content[start..]).into_owned();
    Ok(Some(LogText {
        name: name.to_owned(),
        text,
        truncated,
    }))
}

/// O arquivo de um envio, ou `None` se sumiu do disco.
pub async fn read(data_dir: &Path, id: &str) -> Option<Vec<u8>> {
    tokio::fs::read(file_of(data_dir, id)).await.ok()
}

/// Apaga os envios de mais de 30 dias (a linha e o arquivo). Devolve quantos.
pub async fn prune(db: &SqlitePool, data_dir: &Path, now: i64) -> Result<usize, ApiError> {
    let old: Vec<String> = sqlx::query_scalar("SELECT id FROM log_reports WHERE created_at < ?")
        .bind(now - KEEP_SECS)
        .fetch_all(db)
        .await?;
    for id in &old {
        let _ = tokio::fs::remove_file(file_of(data_dir, id)).await;
        sqlx::query("DELETE FROM log_reports WHERE id = ?")
            .bind(id)
            .execute(db)
            .await?;
    }
    Ok(old.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pasta_dos_dados_sai_do_endereco_do_banco() {
        assert_eq!(
            database_dir("sqlite:///data/ashtar.db?mode=rwc"),
            Some(PathBuf::from("/data"))
        );
        assert_eq!(database_dir("sqlite://ashtar.db"), Some(PathBuf::from(".")));
        assert_eq!(
            database_dir("sqlite:dados/ashtar.db"),
            Some(PathBuf::from("dados"))
        );
        assert_eq!(database_dir("sqlite::memory:"), None);
        assert_eq!(database_dir("postgres://x"), None);
    }

    #[test]
    fn so_aceita_zip() {
        assert!(is_zip(b"PK\x03\x04resto"));
        assert!(!is_zip(b"texto"));
    }
}
