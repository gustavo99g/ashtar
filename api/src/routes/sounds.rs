//! Rotas dos sons do soundboard (ADR 0037, v0.9). Ler os aprovados e os próprios, todo mundo;
//! enviar, quem tem "Enviar sons"; a fila, aprovar, recusar, renomear e excluir qualquer um, quem
//! tem "Aprovar sons". Cada mudança nos aprovados manda a lista inteira no `sounds.changed`, e cada
//! mudança na fila manda o `sounds.queue` com o número.
//!
//! Tocar (`POST /api/voice/sounds/{id}/play`) é de quem está numa sala de voz do grupo ou numa
//! ligação atendida, sem "Bloquear sons" (que só vale nas salas do grupo, como o resto da
//! moderação), dentro do limite do [`crate::limiter::SoundLimiter`].

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use tokio::io::AsyncReadExt;

use super::auth::CurrentUser;
use super::extract::ApiJson;
use super::voice::voice_room_of;
use crate::AppState;
use crate::audit::{self, AuditEntry, AuditKind};
use crate::calls::{self, CallOutcome};
use crate::chat::dms;
use crate::db::now;
use crate::error::ApiError;
use crate::files::FileKind;
use crate::identity::{
    User,
    permissions::{self, Permission},
    users,
};
use crate::moderation;
use crate::realtime::ServerEvent;
use crate::sounds::{
    self, CreateSoundRequest, RejectSoundRequest, Sound, SoundStatus, UpdateSoundRequest,
};

/// Grava no registro (e no histórico da aba Aprovação) o que aconteceu com `sound`. O som vai no
/// `place`, pelo nome; quem enviou é o alvo.
async fn log(
    state: &AppState,
    actor: &User,
    action: &str,
    sound: &Sound,
    detail: Option<String>,
) -> Result<(), ApiError> {
    let uploader = users::find_by_id(&state.db, &sound.uploaded_by).await?;
    audit::record(
        &state.db,
        audit::Entry {
            kind: AuditKind::Sounds,
            action,
            actor,
            target: uploader.as_ref().filter(|user| user.id != actor.id),
            place: Some(sound.name.clone()),
            detail,
        },
        now(),
    )
    .await
}

/// Manda a lista dos aprovados para todos.
async fn publish_approved(state: &AppState) -> Result<(), ApiError> {
    let sounds = sounds::list_approved(&state.db).await?;
    state.hub.publish(&ServerEvent::SoundsChanged { sounds });
    Ok(())
}

/// Manda o tamanho da fila para todos.
async fn publish_queue(state: &AppState) -> Result<(), ApiError> {
    let pending = sounds::pending_count(&state.db).await?;
    state.hub.publish(&ServerEvent::SoundsQueue { pending });
    Ok(())
}

/// Apaga os bytes dos arquivos que saíram do banco. Uma falha só vai para o log.
async fn delete_files(state: &AppState, ids: &[String]) {
    for id in ids {
        if let Err(error) = state.files.delete(id).await {
            eprintln!("som {id}: não deu para apagar do disco: {error}");
        }
    }
}

/// `GET /api/sounds`: os aprovados, por nome.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
) -> Result<Json<Vec<Sound>>, ApiError> {
    Ok(Json(sounds::list_approved(&state.db).await?))
}

/// `GET /api/sounds/mine`: os que a pessoa enviou, em qualquer situação.
pub async fn mine(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<Sound>>, ApiError> {
    Ok(Json(sounds::list_mine(&state.db, &user).await?))
}

/// `GET /api/sounds/pending`: a fila de aprovação. Só com "Aprovar sons".
pub async fn pending(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<Sound>>, ApiError> {
    Ok(Json(sounds::list_pending(&state.db, &user).await?))
}

/// `POST /api/sounds`: envia um som já carregado pelo `POST /api/files?kind=sound`. O 4º
/// aguardando, o 51º aprovado e o nome repetido são 409.
pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(request): ApiJson<CreateSoundRequest>,
) -> Result<(StatusCode, Json<Sound>), ApiError> {
    let file = crate::files::find(&state.db, &request.file_id)
        .await?
        .filter(|file| file.kind == FileKind::Sound && file.uploader_id == user.id)
        .ok_or_else(|| ApiError::InvalidRequest("Esse arquivo não serve para som.".into()))?;
    let mut bytes = Vec::with_capacity(file.size.max(0) as usize);
    state
        .files
        .open(&file.id)
        .await?
        .read_to_end(&mut bytes)
        .await?;
    let created = sounds::create(&state.db, &user, &request, &bytes, now()).await?;
    delete_files(&state, &created.removed_files).await;
    if created.sound.status == SoundStatus::Approved {
        log(&state, &user, "sons.enviar", &created.sound, None).await?;
        publish_approved(&state).await?;
    }
    publish_queue(&state).await?;
    Ok((StatusCode::CREATED, Json(created.sound)))
}

/// `POST /api/sounds/{id}/approve`: o som entra na grade de todo mundo, e quem enviou é avisado.
pub async fn approve(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<Sound>, ApiError> {
    let sound = sounds::approve(&state.db, &user, &id, now()).await?;
    log(&state, &user, "sons.aprovar", &sound, None).await?;
    state.hub.publish_to(
        std::slice::from_ref(&sound.uploaded_by),
        &ServerEvent::SoundReviewed {
            sound: sound.clone(),
        },
    );
    publish_approved(&state).await?;
    publish_queue(&state).await?;
    Ok(Json(sound))
}

/// `POST /api/sounds/{id}/reject`: recusa com o motivo (opcional); quem enviou é avisado.
pub async fn reject(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(request): ApiJson<RejectSoundRequest>,
) -> Result<Json<Sound>, ApiError> {
    let sound = sounds::reject(&state.db, &user, &id, request.reason.as_deref(), now()).await?;
    log(&state, &user, "sons.recusar", &sound, sound.reason.clone()).await?;
    state.hub.publish_to(
        std::slice::from_ref(&sound.uploaded_by),
        &ServerEvent::SoundReviewed {
            sound: sound.clone(),
        },
    );
    publish_queue(&state).await?;
    Ok(Json(sound))
}

/// `PATCH /api/sounds/{id}`: troca o nome e o emoji.
pub async fn update(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(request): ApiJson<UpdateSoundRequest>,
) -> Result<Json<Sound>, ApiError> {
    let before = sounds::find(&state.db, &id).await?;
    let sound = sounds::update(&state.db, &user, &id, &request).await?;
    if sound.status == SoundStatus::Approved {
        // No registro, o nome de antes; o novo vai no detalhe (igual, só o emoji mudou).
        if let Some(before) = before.filter(|b| b.name != sound.name || b.emoji != sound.emoji) {
            log(
                &state,
                &user,
                "sons.renomear",
                &before,
                Some(sound.name.clone()),
            )
            .await?;
        }
        publish_approved(&state).await?;
    }
    Ok(Json(sound))
}

/// `POST /api/voice/sounds/{id}/play`: toca um som aprovado para os outros da sala ou da ligação.
/// Fora de uma sala e de uma ligação é 409; bloqueado, 403; rápido demais, 429.
pub async fn play(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let sound = sounds::find_approved(&state.db, &id).await?;
    let (channel_id, audience) = match voice_room_of(&state, &user.id).await? {
        Some(room) => {
            if moderation::get(&state.db, &user.id).await?.sounds_blocked {
                return Err(ApiError::Forbidden);
            }
            let people = state.hub.people_in(&room);
            (room, people)
        }
        None => {
            let call = calls::current_for(&state.db, &user.id)
                .await?
                .filter(|call| call.outcome == CallOutcome::Answered)
                .ok_or_else(|| {
                    ApiError::Conflict("Entre numa sala de voz para tocar sons.".into())
                })?;
            let dm = dms::get(&state.db, &call.channel_id)
                .await?
                .ok_or_else(|| {
                    ApiError::Conflict("Entre numa sala de voz para tocar sons.".into())
                })?;
            (call.channel_id, dm.members.to_vec())
        }
    };
    state.sound_limiter.try_play(&user.id)?;
    let others: Vec<&String> = audience.iter().filter(|id| **id != user.id).collect();
    state.hub.publish_to(
        &others,
        &ServerEvent::SoundPlayed {
            sound_id: sound.id,
            file_id: sound.file_id,
            user_id: user.id,
            channel_id,
        },
    );
    Ok(StatusCode::NO_CONTENT)
}

/// `DELETE /api/sounds/{id}`: sai o som e o arquivo.
pub async fn delete(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let sound = sounds::delete(&state.db, &user, &id).await?;
    delete_files(&state, std::slice::from_ref(&sound.file_id)).await;
    match sound.status {
        SoundStatus::Approved => {
            log(&state, &user, "sons.excluir", &sound, None).await?;
            publish_approved(&state).await?
        }
        SoundStatus::Pending => publish_queue(&state).await?,
        SoundStatus::Rejected => {}
    }
    Ok(StatusCode::NO_CONTENT)
}

/// `GET /api/sounds/history`: o histórico da aba Aprovação, as 50 ações mais novas (aprovar,
/// recusar, enviar direto, renomear e excluir), com quem fez. Só para quem aprova.
pub async fn history(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<AuditEntry>>, ApiError> {
    permissions::require_permission(&state.db, &user, Permission::ApproveSounds).await?;
    Ok(Json(
        audit::list(&state.db, Some(AuditKind::Sounds), None).await?,
    ))
}
