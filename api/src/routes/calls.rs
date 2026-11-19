//! Rotas das ligações privadas (ADR 0023): ligar, atender, recusar, desistir e
//! desligar, sempre dentro de uma conversa privada.
//!
//! Todas passam pela regra de leitura da conversa: quem não é dela recebe o
//! mesmo 404 de um id que não existe. As regras ficam em [`crate::calls`];
//! aqui fica quem avisa os dois pelo tempo real, o tempo limite do toque e o
//! fim da sala no LiveKit.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;

use super::auth::CurrentUser;
use crate::AppState;
use crate::calls::{self, CallView, Ended, Hangup, Started};
use crate::chat::dms::{self, Dm};
use crate::db::now;
use crate::error::ApiError;
use crate::identity::{User, users};
use crate::realtime::ServerEvent;
use crate::voice;

/// A conversa `channel_id`, se `user` é dela. O resto é 404, com a mesma
/// mensagem da regra de leitura.
async fn dm_of(state: &AppState, user: &User, channel_id: &str) -> Result<Dm, ApiError> {
    dms::find_for(&state.db, &user.id, channel_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Esse canal não existe ou foi arquivado.".into()))
}

/// Avisa os dois de que a ligação acabou e manda o registro dela, que entra
/// no histórico como qualquer mensagem.
pub(crate) fn announce_ended(state: &AppState, ended: &Ended) {
    state.hub.publish_to(
        &ended.members,
        &ServerEvent::CallEnded {
            call_id: ended.call.id.clone(),
            channel_id: ended.call.channel_id.clone(),
            outcome: ended.call.outcome,
            duration: ended.call.duration(),
        },
    );
    state.hub.publish_to(
        &ended.members,
        &ServerEvent::MessageCreated {
            message: ended.message.clone(),
        },
    );
    // A ligação atendida tinha uma sala: apagá-la tira quem ainda estiver lá.
    if ended.call.answered_at.is_some() {
        voice::delete_room_in_background(ended.call.channel_id.clone());
    }
}

/// Depois de [`crate::AppState::ring_timeout`], a ligação que ainda toca vira
/// chamada perdida.
fn expire_later(state: AppState, dm: Dm, call_id: String) {
    tokio::spawn(async move {
        tokio::time::sleep(state.ring_timeout).await;
        match calls::expire(&state.db, &dm, &call_id, now()).await {
            Ok(Some(ended)) => announce_ended(&state, &ended),
            Ok(None) => {}
            Err(error) => eprintln!("ligação {call_id}: não deu para fechar no tempo: {error}"),
        }
    });
}

/// `POST /api/dms/{id}/call`: liga para a outra pessoa da conversa. 201 quando
/// começa a tocar; 200 quando a outra pessoa já estava chamando (vale como
/// atender) ou quando você já estava chamando (a mesma ligação).
///
/// Para quem está offline (ou invisível, que é o mesmo para os outros), e para
/// quem saiu do grupo, 409: a ligação não toca para ninguém.
pub async fn start(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(channel_id): Path<String>,
) -> Result<(StatusCode, Json<CallView>), ApiError> {
    let dm = dm_of(&state, &user, &channel_id).await?;
    let other = users::get_by_id(&state.db, dm.other(&user.id)).await?;
    if !other.is_active() {
        return Err(ApiError::Conflict("Essa pessoa saiu do grupo.".into()));
    }
    if state.hub.shown(&other.id).is_none() {
        return Err(ApiError::Conflict(format!(
            "{} está offline agora.",
            other.shown_name()
        )));
    }
    let started = calls::start(&state.db, &dm, &user, now()).await?;
    let (status, call) = match started {
        Started::Ringing(call) => {
            let view = calls::view(&state.db, &dm, &call).await?;
            state.hub.publish_to(
                &dm.members,
                &ServerEvent::CallRinging { call: view.clone() },
            );
            expire_later(state.clone(), dm, call.id);
            return Ok((StatusCode::CREATED, Json(view)));
        }
        Started::Answered(call) => {
            let view = calls::view(&state.db, &dm, &call).await?;
            state.hub.publish_to(
                &dm.members,
                &ServerEvent::CallAccepted { call: view.clone() },
            );
            (StatusCode::OK, view)
        }
        Started::Already(call) => (StatusCode::OK, calls::view(&state.db, &dm, &call).await?),
    };
    Ok((status, Json(call)))
}

/// `POST /api/dms/{id}/call/accept`: atende a ligação que está tocando para
/// você. 409 sem ligação tocando, ou com você em outra ligação.
pub async fn accept(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(channel_id): Path<String>,
) -> Result<Json<CallView>, ApiError> {
    let dm = dm_of(&state, &user, &channel_id).await?;
    let call = calls::accept(&state.db, &dm, &user, now()).await?;
    let view = calls::view(&state.db, &dm, &call).await?;
    state.hub.publish_to(
        &dm.members,
        &ServerEvent::CallAccepted { call: view.clone() },
    );
    Ok(Json(view))
}

async fn hang_up(
    state: AppState,
    user: User,
    channel_id: String,
    how: Hangup,
) -> Result<StatusCode, ApiError> {
    let dm = dm_of(&state, &user, &channel_id).await?;
    let ended = calls::hang_up(&state.db, &dm, &user, how, now()).await?;
    announce_ended(&state, &ended);
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/dms/{id}/call/decline`: recusa a ligação que está tocando para
/// você. 204; 409 sem ligação tocando.
pub async fn decline(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(channel_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    hang_up(state, user, channel_id, Hangup::Decline).await
}

/// `POST /api/dms/{id}/call/cancel`: desiste da ligação que você fez, antes de
/// atenderem. 204; 409 sem ligação sua tocando.
pub async fn cancel(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(channel_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    hang_up(state, user, channel_id, Hangup::Cancel).await
}

/// `POST /api/dms/{id}/call/end`: desliga. Na ligação atendida, encerra para os
/// dois; tocando, é recusar ou desistir, conforme quem pede. 204; 409 sem
/// ligação.
pub async fn end(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(channel_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    hang_up(state, user, channel_id, Hangup::End).await
}
