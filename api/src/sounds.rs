//! Os sons do soundboard (ADR 0037, v0.9): enviar, aprovar, recusar, renomear e excluir.
//!
//! Quem tem "Enviar sons" (todo mundo, por padrão) manda um som, que fica `pending` até alguém com
//! "Aprovar sons" aprovar ou recusar; os sons de quem aprova entram direto. O app corta e ajusta o
//! volume antes de enviar e sobe um WAV: aqui a API só confere o cabeçalho (a duração e o formato)
//! e os limites. Tocar fica em `routes/voice.rs` (Etapa 6).

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use crate::error::ApiError;
use crate::identity::User;
use crate::identity::permissions::{self, Permission};

/// Quantos sons aprovados o grupo pode ter.
pub const SOUNDS_MAX: i64 = 50;
/// Quantos sons uma pessoa pode ter aguardando aprovação ao mesmo tempo.
pub const PENDING_PER_PERSON: i64 = 3;
/// A duração máxima de um som, em milissegundos, com uma folga para o arredondamento do editor.
pub const MAX_DURATION_MS: i64 = 5_000;
const DURATION_SLACK_MS: i64 = 50;
/// O nome, em caracteres.
pub const NAME_MAX_CHARS: usize = 24;
/// O motivo da recusa, em caracteres.
pub const REASON_MAX_CHARS: usize = 200;
/// Os tipos que o app manda para o WAV.
const MIMES: [&str; 4] = ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"];

/// A situação de um som.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
pub enum SoundStatus {
    Pending,
    Approved,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS, FromRow)]
#[ts(export, export_to = "index.ts")]
pub struct Sound {
    pub id: String,
    pub name: String,
    /// O emoji que aparece no botão (Unicode), ou nenhum.
    pub emoji: Option<String>,
    /// O WAV (`GET /api/files/{id}`).
    pub file_id: String,
    #[ts(type = "number")]
    pub duration_ms: i64,
    pub uploaded_by: String,
    /// O nome de quem enviou, como aparece.
    pub uploader_name: String,
    pub status: SoundStatus,
    /// Só no recusado: o que quem recusou escreveu.
    pub reason: Option<String>,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number | null")]
    pub reviewed_at: Option<i64>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct CreateSoundRequest {
    /// Um arquivo `sound` enviado antes pelo `POST /api/files`.
    pub file_id: String,
    pub name: String,
    #[ts(optional)]
    pub emoji: Option<String>,
    /// Um som seu, aguardando ou recusado, que este substitui (o "Editar e reenviar"): sai junto.
    #[ts(optional)]
    pub replaces: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct UpdateSoundRequest {
    pub name: String,
    #[ts(optional)]
    pub emoji: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct RejectSoundRequest {
    #[ts(optional)]
    pub reason: Option<String>,
}

/// A duração de um WAV PCM (ou float), em milissegundos, lida do cabeçalho. `None` se não for um
/// WAV que o app toca: sem `RIFF`/`WAVE`, sem `fmt ` ou `data`, ou com um formato estranho.
pub fn wav_duration_ms(bytes: &[u8]) -> Option<i64> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return None;
    }
    let u16_at = |at: usize| Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?));
    let u32_at = |at: usize| Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?));
    let mut pos = 12;
    let mut format = None;
    let mut data_len = None;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32_at(pos + 4)? as usize;
        let body = pos + 8;
        if id == b"fmt " {
            if size < 16 {
                return None;
            }
            // Formato, canais, amostras por segundo e bits por amostra.
            format = Some((
                u16_at(body)?,
                u16_at(body + 2)?,
                u32_at(body + 4)?,
                u16_at(body + 14)?,
            ));
        } else if id == b"data" {
            data_len = Some(size.min(bytes.len() - body));
            break;
        }
        // Os blocos têm tamanho par.
        pos = body.checked_add(size)?.checked_add(size & 1)?;
    }
    let (tag, channels, rate, bits) = format?;
    // 1: PCM; 3: float; 0xFFFE: o formato estendido, que guarda um dos dois.
    let known = matches!(tag, 1 | 3 | 0xFFFE);
    if !known || !(1..=2).contains(&channels) || !(8_000..=96_000).contains(&rate) {
        return None;
    }
    if !matches!(bits, 8 | 16 | 24 | 32) {
        return None;
    }
    let per_second = u64::from(rate) * u64::from(channels) * u64::from(bits / 8);
    Some((data_len? as u64 * 1000 / per_second) as i64)
}

/// O nome: sem espaço nas pontas, de 1 a 24 caracteres.
pub fn validate_name(input: &str) -> Result<String, ApiError> {
    let name = input.trim();
    let count = name.chars().count();
    if count == 0 || count > NAME_MAX_CHARS || name.chars().any(char::is_control) {
        return Err(ApiError::InvalidRequest(
            "O nome do som tem de 1 a 24 caracteres.".into(),
        ));
    }
    Ok(name.to_owned())
}

/// O emoji: vazio vira nenhum; senão, até 64 bytes e sem espaço.
fn validate_emoji(input: Option<&str>) -> Result<Option<String>, ApiError> {
    let Some(emoji) = input.map(str::trim).filter(|e| !e.is_empty()) else {
        return Ok(None);
    };
    if emoji.len() > 64 || emoji.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(ApiError::InvalidRequest("Esse emoji não serve.".into()));
    }
    Ok(Some(emoji.to_owned()))
}

/// A chave que não pode repetir: o nome em minúsculas.
fn name_key(name: &str) -> String {
    name.to_lowercase()
}

fn taken() -> ApiError {
    ApiError::Conflict("Já tem um som com esse nome.".into())
}

fn not_found() -> ApiError {
    ApiError::NotFound("Esse som não existe mais.".into())
}

fn is_unique_violation(error: &sqlx::Error) -> bool {
    matches!(error, sqlx::Error::Database(e) if e.is_unique_violation())
}

/// A consulta de um som com o nome de quem enviou, com o resto (`WHERE`, `ORDER BY`) colado no fim:
/// o sqlx só aceita texto fixo.
macro_rules! select_sound {
    ($rest:literal) => {
        concat!(
            "SELECT s.id, s.name, s.emoji, s.file_id, s.duration_ms, s.uploaded_by,
                    COALESCE(u.display_name, u.nick) AS uploader_name, s.status, s.reason,
                    s.created_at, s.reviewed_at
             FROM sounds s JOIN users u ON u.id = s.uploaded_by ",
            $rest
        )
    };
}

/// Os aprovados, por nome: a grade de todo mundo e a aba Todos os sons.
pub async fn list_approved(db: &SqlitePool) -> Result<Vec<Sound>, ApiError> {
    Ok(sqlx::query_as(select_sound!(
        "WHERE s.status = 'approved' ORDER BY s.name_key"
    ))
    .fetch_all(db)
    .await?)
}

/// Os que `user` enviou, do mais novo para o mais antigo: a aba Meus sons.
pub async fn list_mine(db: &SqlitePool, user: &User) -> Result<Vec<Sound>, ApiError> {
    Ok(sqlx::query_as(select_sound!(
        "WHERE s.uploaded_by = ? ORDER BY s.created_at DESC, s.id DESC"
    ))
    .bind(&user.id)
    .fetch_all(db)
    .await?)
}

/// A fila de aprovação, do mais antigo para o mais novo. Só para quem aprova.
pub async fn list_pending(db: &SqlitePool, actor: &User) -> Result<Vec<Sound>, ApiError> {
    permissions::require_permission(db, actor, Permission::ApproveSounds).await?;
    Ok(sqlx::query_as(select_sound!(
        "WHERE s.status = 'pending' ORDER BY s.created_at, s.id"
    ))
    .fetch_all(db)
    .await?)
}

/// Quantos aguardam aprovação: o contador da aba.
pub async fn pending_count(db: &SqlitePool) -> Result<i64, ApiError> {
    Ok(
        sqlx::query_scalar("SELECT count(*) FROM sounds WHERE status = 'pending'")
            .fetch_one(db)
            .await?,
    )
}

/// Um som pelo id, em qualquer situação.
pub async fn find(db: &SqlitePool, id: &str) -> Result<Option<Sound>, ApiError> {
    Ok(sqlx::query_as(select_sound!("WHERE s.id = ?"))
        .bind(id)
        .fetch_optional(db)
        .await?)
}

/// Um som aprovado pelo id (o que se toca).
pub async fn find_approved(db: &SqlitePool, id: &str) -> Result<Sound, ApiError> {
    find(db, id)
        .await?
        .filter(|sound| sound.status == SoundStatus::Approved)
        .ok_or_else(not_found)
}

/// O que um envio devolve: o som e os arquivos que saíram (do som substituído), para quem chama
/// apagar os bytes depois.
pub struct Created {
    pub sound: Sound,
    pub removed_files: Vec<String>,
}

/// Envia um som. `bytes` é o arquivo já gravado (o route lê do disco), para conferir o WAV.
pub async fn create(
    db: &SqlitePool,
    actor: &User,
    request: &CreateSoundRequest,
    bytes: &[u8],
    now: i64,
) -> Result<Created, ApiError> {
    let approver = permissions::has(db, actor, Permission::ApproveSounds).await?;
    if !approver {
        permissions::require_permission(db, actor, Permission::SendSounds).await?;
    }
    let name = validate_name(&request.name)?;
    let emoji = validate_emoji(request.emoji.as_deref())?;
    let duration_ms = wav_duration_ms(bytes).ok_or_else(|| {
        ApiError::InvalidRequest("O som precisa ser um WAV gerado pelo editor.".into())
    })?;
    if duration_ms > MAX_DURATION_MS + DURATION_SLACK_MS {
        return Err(ApiError::InvalidRequest(
            "O som pode ter até 5 segundos. Corte um trecho no editor.".into(),
        ));
    }
    if duration_ms == 0 {
        return Err(ApiError::InvalidRequest("O som está vazio.".into()));
    }

    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    let file: Option<String> = sqlx::query_scalar(
        "SELECT mime FROM files
         WHERE id = ? AND uploader_id = ? AND kind = 'sound' AND used_at IS NULL",
    )
    .bind(&request.file_id)
    .bind(&actor.id)
    .fetch_optional(&mut *tx)
    .await?;
    match file {
        Some(mime) if MIMES.contains(&mime.as_str()) => {}
        _ => {
            return Err(ApiError::InvalidRequest(
                "Esse arquivo não serve para som.".into(),
            ));
        }
    }

    // O som substituído sai antes de contar os limites: editar não esbarra no próprio.
    let mut removed_files = Vec::new();
    if let Some(replaced) = &request.replaces {
        let old: Option<(String, SoundStatus)> =
            sqlx::query_as("SELECT file_id, status FROM sounds WHERE id = ? AND uploaded_by = ?")
                .bind(replaced)
                .bind(&actor.id)
                .fetch_optional(&mut *tx)
                .await?;
        match old {
            Some((file_id, SoundStatus::Pending | SoundStatus::Rejected)) => {
                sqlx::query("DELETE FROM sounds WHERE id = ?")
                    .bind(replaced)
                    .execute(&mut *tx)
                    .await?;
                sqlx::query("DELETE FROM files WHERE id = ?")
                    .bind(&file_id)
                    .execute(&mut *tx)
                    .await?;
                removed_files.push(file_id);
            }
            _ => return Err(not_found()),
        }
    }

    let status = if approver {
        let approved: i64 =
            sqlx::query_scalar("SELECT count(*) FROM sounds WHERE status = 'approved'")
                .fetch_one(&mut *tx)
                .await?;
        if approved >= SOUNDS_MAX {
            return Err(full());
        }
        SoundStatus::Approved
    } else {
        let pending: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM sounds WHERE uploaded_by = ? AND status = 'pending'",
        )
        .bind(&actor.id)
        .fetch_one(&mut *tx)
        .await?;
        if pending >= PENDING_PER_PERSON {
            return Err(ApiError::Conflict(
                "Você já tem 3 sons aguardando aprovação. Espere um ser aprovado ou cancele um."
                    .into(),
            ));
        }
        SoundStatus::Pending
    };

    let id = Uuid::now_v7().to_string();
    let reviewed = approver.then_some(now);
    let inserted = sqlx::query(
        "INSERT INTO sounds (id, name, name_key, emoji, file_id, duration_ms, uploaded_by, status,
                             reviewed_by, reviewed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&name)
    .bind(name_key(&name))
    .bind(&emoji)
    .bind(&request.file_id)
    .bind(duration_ms)
    .bind(&actor.id)
    .bind(status)
    .bind(reviewed.map(|_| actor.id.clone()))
    .bind(reviewed)
    .bind(now)
    .execute(&mut *tx)
    .await;
    match inserted {
        Err(error) if is_unique_violation(&error) => return Err(taken()),
        other => other?,
    };
    sqlx::query("UPDATE files SET duration_ms = ? WHERE id = ?")
        .bind(duration_ms)
        .bind(&request.file_id)
        .execute(&mut *tx)
        .await?;
    crate::files::mark_used(&mut tx, std::slice::from_ref(&request.file_id), now).await?;
    tx.commit().await?;
    let sound = find(db, &id).await?.ok_or_else(not_found)?;
    Ok(Created {
        sound,
        removed_files,
    })
}

fn full() -> ApiError {
    ApiError::Conflict("O grupo já tem 50 sons. Exclua um antes de aprovar outro.".into())
}

/// Aprova um som que aguarda.
pub async fn approve(db: &SqlitePool, actor: &User, id: &str, now: i64) -> Result<Sound, ApiError> {
    permissions::require_permission(db, actor, Permission::ApproveSounds).await?;
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    let approved: i64 = sqlx::query_scalar("SELECT count(*) FROM sounds WHERE status = 'approved'")
        .fetch_one(&mut *tx)
        .await?;
    if approved >= SOUNDS_MAX {
        return Err(full());
    }
    let done = sqlx::query(
        "UPDATE sounds SET status = 'approved', reason = NULL, reviewed_by = ?, reviewed_at = ?
         WHERE id = ? AND status = 'pending'",
    )
    .bind(&actor.id)
    .bind(now)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    if done.rows_affected() == 0 {
        return Err(not_pending());
    }
    tx.commit().await?;
    find(db, id).await?.ok_or_else(not_found)
}

fn not_pending() -> ApiError {
    ApiError::Conflict("Esse som não está mais aguardando aprovação.".into())
}

/// Recusa um som que aguarda, com o motivo (opcional). O nome fica livre de novo.
pub async fn reject(
    db: &SqlitePool,
    actor: &User,
    id: &str,
    reason: Option<&str>,
    now: i64,
) -> Result<Sound, ApiError> {
    permissions::require_permission(db, actor, Permission::ApproveSounds).await?;
    let reason = reason.map(str::trim).filter(|r| !r.is_empty());
    if reason.is_some_and(|r| r.chars().count() > REASON_MAX_CHARS) {
        return Err(ApiError::InvalidRequest(
            "O motivo tem até 200 caracteres.".into(),
        ));
    }
    let done = sqlx::query(
        "UPDATE sounds SET status = 'rejected', reason = ?, reviewed_by = ?, reviewed_at = ?
         WHERE id = ? AND status = 'pending'",
    )
    .bind(reason)
    .bind(&actor.id)
    .bind(now)
    .bind(id)
    .execute(db)
    .await?;
    if done.rows_affected() == 0 {
        return Err(not_pending());
    }
    find(db, id).await?.ok_or_else(not_found)
}

/// Troca o nome e o emoji. Quem aprova, de qualquer som; quem enviou, do seu enquanto aguarda.
pub async fn update(
    db: &SqlitePool,
    actor: &User,
    id: &str,
    request: &UpdateSoundRequest,
) -> Result<Sound, ApiError> {
    let sound = find(db, id).await?.ok_or_else(not_found)?;
    let approver = permissions::has(db, actor, Permission::ApproveSounds).await?;
    let own_pending = sound.uploaded_by == actor.id && sound.status == SoundStatus::Pending;
    if !approver && !own_pending {
        return Err(ApiError::Forbidden);
    }
    let name = validate_name(&request.name)?;
    let emoji = validate_emoji(request.emoji.as_deref())?;
    let done = sqlx::query("UPDATE sounds SET name = ?, name_key = ?, emoji = ? WHERE id = ?")
        .bind(&name)
        .bind(name_key(&name))
        .bind(&emoji)
        .bind(id)
        .execute(db)
        .await;
    match done {
        Err(error) if is_unique_violation(&error) => return Err(taken()),
        other => other?,
    };
    find(db, id).await?.ok_or_else(not_found)
}

/// Exclui um som e o arquivo dele. Quem aprova, qualquer um; quem enviou, o seu que aguarda
/// (cancelar) ou foi recusado (apagar). Devolve o som que saiu, para quem chama apagar os bytes
/// e avisar quem precisa.
pub async fn delete(db: &SqlitePool, actor: &User, id: &str) -> Result<Sound, ApiError> {
    let sound = find(db, id).await?.ok_or_else(not_found)?;
    let approver = permissions::has(db, actor, Permission::ApproveSounds).await?;
    let own_unapproved = sound.uploaded_by == actor.id && sound.status != SoundStatus::Approved;
    if !approver && !own_unapproved {
        return Err(ApiError::Forbidden);
    }
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;
    sqlx::query("DELETE FROM sounds WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM files WHERE id = ?")
        .bind(&sound.file_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(sound)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Um WAV mono de 16 bits a 48 kHz com `ms` milissegundos de silêncio.
    pub fn wav(ms: u32) -> Vec<u8> {
        let rate = 48_000u32;
        let data_len = rate / 1000 * ms * 2;
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data_len).to_le_bytes());
        out.extend_from_slice(b"WAVE");
        out.extend_from_slice(b"fmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * 2).to_le_bytes());
        out.extend_from_slice(&2u16.to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&data_len.to_le_bytes());
        out.resize(out.len() + data_len as usize, 0);
        out
    }

    #[test]
    fn a_duracao_sai_do_cabecalho_do_wav() {
        assert_eq!(wav_duration_ms(&wav(2_400)), Some(2_400));
        assert_eq!(wav_duration_ms(&wav(5_000)), Some(5_000));
    }

    #[test]
    fn um_bloco_antes_do_fmt_e_pulado() {
        let mut bytes = wav(1_000);
        // Um bloco LIST de 3 bytes (com o byte de enchimento) logo depois do WAVE.
        let list = [b"LIST".as_slice(), &3u32.to_le_bytes(), b"abc\0"].concat();
        bytes.splice(12..12, list);
        assert_eq!(wav_duration_ms(&bytes), Some(1_000));
    }

    #[test]
    fn o_que_nao_e_wav_nao_passa() {
        assert_eq!(wav_duration_ms(b"ID3\x04\x00\x00\x00\x00\x00\x00"), None);
        assert_eq!(wav_duration_ms(b"RIFF\x00\x00\x00\x00WEBPVP8 "), None);
        let mut no_data = wav(100);
        no_data.truncate(36);
        assert_eq!(wav_duration_ms(&no_data), None);
    }

    #[test]
    fn o_nome_tem_de_1_a_24_caracteres() {
        assert_eq!(validate_name("  Ba-dum-tss ").unwrap(), "Ba-dum-tss");
        assert_eq!(validate_name("Nããããão").unwrap(), "Nããããão");
        assert!(validate_name("").is_err());
        assert!(validate_name(&"a".repeat(25)).is_err());
    }
}
