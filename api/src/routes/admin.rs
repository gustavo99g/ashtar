//! O estado do servidor no Painel (v0.6, decisão 21): a API, o LiveKit, o disco e o último
//! backup. Só o dono; para os outros, 404. Sem histórico: o app pergunta ao abrir e no botão.

use std::path::Path;

use axum::Json;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Query, State};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::auth::CurrentUser;
use crate::AppState;
use crate::audit::{self, AuditEntry, AuditKind};
use crate::db::now;
use crate::error::ApiError;
use crate::voice;

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct ServerStatus {
    pub api: ApiStatus,
    pub livekit: LiveKitStatus,
    /// `None` quando o sistema não diz (fora do Linux).
    pub disk: Option<DiskStatus>,
    /// O backup mais novo de `data/backups/`, ou `None` sem nenhum.
    pub last_backup: Option<BackupStatus>,
    /// A última cópia das fotos, emojis e sons para o R2 (v0.9, ADR 0036), ou `None` sem nenhuma.
    pub last_files_backup: Option<FilesBackupStatus>,
    /// Quanto os arquivos (fotos, anexos, prévias e emojis) ocupam, em bytes (ADR 0031).
    #[ts(type = "number")]
    pub files_bytes: i64,
}

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct ApiStatus {
    pub version: String,
    /// Há quanto tempo está no ar, em segundos.
    #[ts(type = "number")]
    pub uptime_secs: i64,
}

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct LiveKitStatus {
    pub ok: bool,
    /// Quanto levou para responder, em ms.
    #[ts(type = "number | null")]
    pub latency_ms: Option<u64>,
    /// O que deu errado, para o log do dono.
    pub error: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct DiskStatus {
    #[ts(type = "number")]
    pub free_bytes: u64,
    #[ts(type = "number")]
    pub total_bytes: u64,
}

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct BackupStatus {
    pub name: String,
    /// Quando foi feito (a data de modificação do arquivo), em segundos.
    #[ts(type = "number")]
    pub at: i64,
    #[ts(type = "number")]
    pub size: u64,
}

/// A cópia dos arquivos que deu certo: o `backup.sh` escreve [`FILES_BACKUP_MARK`] depois do
/// rclone, com quantos arquivos estavam na lista.
#[derive(Debug, Serialize, TS, PartialEq, Eq)]
#[ts(export, export_to = "index.ts")]
pub struct FilesBackupStatus {
    #[ts(type = "number")]
    pub at: i64,
    #[ts(type = "number")]
    pub files: u64,
}

/// O arquivo que marca a última cópia dos arquivos, em `data/backups/`.
pub const FILES_BACKUP_MARK: &str = "arquivos-ok";

/// O filtro e a página do `GET /api/admin/audit`.
#[derive(Debug, Deserialize)]
pub struct AuditQuery {
    /// Sem ele, tudo.
    pub kind: Option<AuditKind>,
    /// O id da última linha da página anterior.
    pub before: Option<i64>,
}

/// `GET /api/admin/audit?kind=voice&before=123`: o registro do grupo, de 50 em 50, da linha mais
/// nova para a mais velha (ADR 0034). Só o dono: não é uma permissão que se dá.
pub async fn audit(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    query: Result<Query<AuditQuery>, QueryRejection>,
) -> Result<Json<Vec<AuditEntry>>, ApiError> {
    if !user.is_owner || !user.is_active() {
        return Err(ApiError::Forbidden);
    }
    let Query(query) = query
        .map_err(|_| ApiError::InvalidRequest("O pedido não está no formato esperado.".into()))?;
    Ok(Json(
        audit::list(&state.db, query.kind, query.before).await?,
    ))
}

/// `GET /api/admin/status`.
pub async fn status(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<ServerStatus>, ApiError> {
    if !user.is_owner {
        return Err(ApiError::NotFound("Não encontrado.".into()));
    }
    let livekit = match voice::livekit_latency().await {
        Ok(latency) => LiveKitStatus {
            ok: true,
            latency_ms: Some(latency.as_millis() as u64),
            error: None,
        },
        Err(error) => {
            let detail = match &error {
                ApiError::LiveKit(detail) | ApiError::Config(detail) => detail.clone(),
                other => other.to_string(),
            };
            LiveKitStatus {
                ok: false,
                latency_ms: None,
                error: Some(detail),
            }
        }
    };
    Ok(Json(ServerStatus {
        api: ApiStatus {
            version: env!("CARGO_PKG_VERSION").into(),
            uptime_secs: now() - state.started_at,
        },
        livekit,
        disk: disk(&state.data_dir),
        last_backup: last_backup(&state.data_dir.join("backups")),
        last_files_backup: last_files_backup(&state.data_dir.join("backups")),
        files_bytes: crate::files::total_size(&state.db).await?,
    }))
}

/// O espaço livre e o total do disco de `dir`.
#[cfg(unix)]
pub fn disk(dir: &Path) -> Option<DiskStatus> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let path = CString::new(dir.as_os_str().as_bytes()).ok()?;
    // SAFETY: `path` é um C string válido até o fim da chamada, e `stats` é escrito pelo sistema.
    let mut stats: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(path.as_ptr(), &mut stats) } != 0 {
        return None;
    }
    let block = stats.f_frsize as u64;
    Some(DiskStatus {
        free_bytes: stats.f_bavail as u64 * block,
        total_bytes: stats.f_blocks as u64 * block,
    })
}

#[cfg(not(unix))]
pub fn disk(_dir: &Path) -> Option<DiskStatus> {
    None
}

/// O `ashtar-*.db` mais novo da pasta (os nomes têm a data: o maior é o mais novo).
pub fn last_backup(dir: &Path) -> Option<BackupStatus> {
    let newest = std::fs::read_dir(dir)
        .ok()?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with("ashtar-") && name.ends_with(".db"))
        })
        .max_by_key(|entry| entry.file_name())?;
    let meta = newest.metadata().ok()?;
    let at = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs() as i64);
    Some(BackupStatus {
        name: newest.file_name().to_string_lossy().into_owned(),
        at,
        size: meta.len(),
    })
}

/// A marca da última cópia dos arquivos: a data é a do arquivo, e o conteúdo, quantos foram.
pub fn last_files_backup(dir: &Path) -> Option<FilesBackupStatus> {
    let path = dir.join(FILES_BACKUP_MARK);
    let meta = std::fs::metadata(&path).ok()?;
    let at = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs() as i64);
    let files = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| text.trim().parse().ok())
        .unwrap_or(0);
    Some(FilesBackupStatus { at, files })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_marca_da_copia_dos_arquivos_diz_quantos_foram() {
        let dir = std::env::temp_dir().join(format!("ashtar-files-mark-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(last_files_backup(&dir).is_none());
        std::fs::write(dir.join(FILES_BACKUP_MARK), "42\n").unwrap();
        let last = last_files_backup(&dir).unwrap();
        assert_eq!(last.files, 42);
        assert!(last.at > 0);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn o_ultimo_backup_e_o_de_nome_maior() {
        let dir = std::env::temp_dir().join(format!("ashtar-status-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(last_backup(&dir).is_none());
        std::fs::write(dir.join("ashtar-2026-11-01-120000000.db"), b"a").unwrap();
        std::fs::write(dir.join("ashtar-2026-11-19-223000000.db"), b"abc").unwrap();
        std::fs::write(dir.join("outra-coisa.txt"), b"x").unwrap();
        let last = last_backup(&dir).unwrap();
        assert_eq!(last.name, "ashtar-2026-11-19-223000000.db");
        assert_eq!(last.size, 3);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn o_disco_da_pasta_tem_tamanho() {
        let disk = disk(&std::env::temp_dir()).unwrap();
        assert!(disk.total_bytes > 0);
        assert!(disk.free_bytes <= disk.total_bytes);
    }
}
