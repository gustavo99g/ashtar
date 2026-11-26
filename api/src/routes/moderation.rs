//! Rotas da moderação na voz (ADR 0034): silenciar, deixar surdo, desligar a câmera e encerrar a
//! transmissão de alguém numa sala de voz do grupo. Só com "Moderar voz" (o dono sempre tem).
//!
//! Silenciar e deixar surdo são chaves (`PUT` liga, `DELETE` libera) e ficam no banco até alguém
//! liberar: valem em todas as salas de voz. Desligar a câmera e encerrar a transmissão são de uma
//! vez só. Numa ligação privada nada disso vale: a pessoa fora de uma sala de voz do grupo dá
//! `404`, como uma sala que não existe.

use axum::extract::{Path, State};
use axum::http::StatusCode;

use super::auth::CurrentUser;
use super::voice::{active_member, voice_room_of};
use crate::AppState;
use crate::audit::{self, AuditKind};
use crate::chat::access;
use crate::db::now;
use crate::error::ApiError;
use crate::identity::User;
use crate::identity::permissions::{Permission, require_permission};
use crate::moderation::{self, Imposed, ModerationAction};
use crate::realtime::ServerEvent;
use crate::voice;

/// Quem `user` vai moderar: um membro ativo, que não é o dono nem ele mesmo.
async fn target(state: &AppState, user: &User, target_id: &str) -> Result<User, ApiError> {
    require_permission(&state.db, user, Permission::ModerateVoice).await?;
    let target = active_member(state, target_id).await?;
    if target.is_owner {
        return Err(ApiError::Conflict("Ninguém modera o dono do grupo.".into()));
    }
    if target.id == user.id {
        return Err(ApiError::Conflict(
            "Você não pode moderar a si mesmo.".into(),
        ));
    }
    Ok(target)
}

/// A sala de voz do grupo em que `target` está, ou `404`.
async fn room_of(state: &AppState, target: &User) -> Result<String, ApiError> {
    voice_room_of(state, &target.id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Essa pessoa não está numa sala de voz.".into()))
}

/// Troca o estado imposto de `target`: grava, avisa a pessoa, publica a lista da sala e manda o
/// LiveKit aplicar. Ligar exige a pessoa numa sala de voz; liberar vale em qualquer lugar (ela
/// pode ter saído).
async fn change(
    state: &AppState,
    user: &User,
    target_id: &str,
    action: ModerationAction,
) -> Result<StatusCode, ApiError> {
    let target = target(state, user, target_id).await?;
    let room = voice_room_of(state, &target.id).await?;
    let mut imposed = moderation::get(&state.db, &target.id).await?;
    match action {
        ModerationAction::Mute => imposed.mic_muted = true,
        ModerationAction::Unmute => imposed.mic_muted = false,
        ModerationAction::Deafen => imposed.deafened = true,
        ModerationAction::Undeafen => imposed.deafened = false,
        ModerationAction::BlockSounds => imposed.sounds_blocked = true,
        ModerationAction::UnblockSounds => imposed.sounds_blocked = false,
        ModerationAction::CameraOff | ModerationAction::StopShare => {
            unreachable!("desligar a câmera e encerrar a transmissão não são chaves")
        }
    }
    // Bloquear sons vale fora da sala também: é uma chave, como as outras, mas não depende do
    // LiveKit, e a pessoa pode entrar depois.
    if room.is_none() && matches!(action, ModerationAction::Mute | ModerationAction::Deafen) {
        return Err(ApiError::NotFound(
            "Essa pessoa não está numa sala de voz.".into(),
        ));
    }
    let imposed = moderation::set(&state.db, &target.id, imposed, &user.id, now()).await?;
    log(state, user, &target, action, room.as_deref()).await?;
    // O LiveKit primeiro: liberado, o app da pessoa reabre o microfone assim que recebe o evento, e
    // a permissão já tem de estar de volta.
    let sounds_only = matches!(
        action,
        ModerationAction::BlockSounds | ModerationAction::UnblockSounds
    );
    if let Some(room) = room.as_deref().filter(|_| !sounds_only) {
        voice::restrict_now(room, &target.id, imposed).await;
    }
    notify(state, user, &target, action, imposed);
    if let Some((room, list)) = state.hub.set_moderated(&target.id, imposed) {
        let to = access::audience(&state.db, &room).await?;
        state.hub.publish_voice_participants(room, list, to);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Grava a ação no registro, com a sala pelo nome.
async fn log(
    state: &AppState,
    by: &User,
    target: &User,
    action: ModerationAction,
    room: Option<&str>,
) -> Result<(), ApiError> {
    let place = match room {
        Some(room) => audit::channel_name(&state.db, room).await?,
        None => None,
    };
    audit::record(
        &state.db,
        audit::Entry {
            kind: AuditKind::Voice,
            action: action.key(),
            actor: by,
            target: Some(target),
            place,
            detail: None,
        },
        now(),
    )
    .await
}

/// O `voice.moderated` para as conexões de `target`.
fn notify(state: &AppState, by: &User, target: &User, action: ModerationAction, imposed: Imposed) {
    state.hub.publish_to(
        &[&target.id],
        &ServerEvent::VoiceModerated {
            action,
            server_muted: imposed.mic_muted,
            server_deafened: imposed.deafened,
            sounds_blocked: imposed.sounds_blocked,
            by: by.id.clone(),
            by_name: by.shown_name().to_owned(),
        },
    );
}

/// `PUT /api/voice/moderation/{user_id}/mute`: silencia o microfone.
pub async fn mute(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    change(&state, &user, &id, ModerationAction::Mute).await
}

/// `DELETE /api/voice/moderation/{user_id}/mute`: libera o microfone.
pub async fn unmute(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    change(&state, &user, &id, ModerationAction::Unmute).await
}

/// `PUT /api/voice/moderation/{user_id}/deafen`: deixa surdo.
pub async fn deafen(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    change(&state, &user, &id, ModerationAction::Deafen).await
}

/// `DELETE /api/voice/moderation/{user_id}/deafen`: devolve o áudio.
pub async fn undeafen(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    change(&state, &user, &id, ModerationAction::Undeafen).await
}

/// `PUT /api/voice/moderation/{user_id}/sounds`: bloqueia os sons do soundboard (ADR 0037).
pub async fn block_sounds(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    change(&state, &user, &id, ModerationAction::BlockSounds).await
}

/// `DELETE /api/voice/moderation/{user_id}/sounds`: libera os sons.
pub async fn unblock_sounds(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    change(&state, &user, &id, ModerationAction::UnblockSounds).await
}

/// `POST /api/voice/moderation/{user_id}/camera-off`: desliga a câmera. A pessoa pode ligar de novo.
pub async fn camera_off(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let target = target(&state, &user, &id).await?;
    let room = room_of(&state, &target).await?;
    let imposed = moderation::get(&state.db, &target.id).await?;
    log(
        &state,
        &user,
        &target,
        ModerationAction::CameraOff,
        Some(&room),
    )
    .await?;
    notify(&state, &user, &target, ModerationAction::CameraOff, imposed);
    voice::mute_camera_in_background(room, target.id);
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/voice/moderation/{user_id}/stop-share`: encerra a transmissão de tela (só a tela; a
/// câmera tem o próprio). O evento vai antes, para o app não tratar a queda como falha de rede.
pub async fn stop_share(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let target = target(&state, &user, &id).await?;
    let room = room_of(&state, &target).await?;
    let imposed = moderation::get(&state.db, &target.id).await?;
    log(
        &state,
        &user,
        &target,
        ModerationAction::StopShare,
        Some(&room),
    )
    .await?;
    notify(&state, &user, &target, ModerationAction::StopShare, imposed);
    voice::stop_share_in_background(room, target.id);
    Ok(StatusCode::NO_CONTENT)
}
