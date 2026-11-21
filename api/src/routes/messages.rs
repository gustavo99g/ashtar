//! Rotas do chat: o histórico de um canal e o envio.
//!
//! Todo membro ativo lê e escreve nos canais de texto que existem (ADR 0015),
//! e cada conversa privada é só das duas pessoas dela (ADR 0021). Quem decide é
//! a regra de leitura, [`access::readable`], e as duas rotas passam por ela.

use axum::Json;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use serde::Deserialize;
use ts_rs::TS;

use super::auth::CurrentUser;
use super::extract::ApiJson;
use crate::AppState;
use crate::chat::access::{self, Readable};
use crate::chat::messages::{
    self, CATCH_UP_MAX, Cursor, Message, MessagePage, PAGE_DEFAULT, PAGE_MAX,
};
use crate::chat::search::{self, SearchPage, SearchQuery};
use crate::db::now;
use crate::error::ApiError;
use crate::identity::User;
use crate::identity::users;
use crate::realtime::ServerEvent;

#[derive(Debug, Deserialize)]
pub struct PageQuery {
    pub before: Option<String>,
    pub after: Option<String>,
    pub around: Option<String>,
    pub limit: Option<i64>,
}

/// `GET /api/channels/{id}/messages`: sem nada, as 50 mais novas;
/// `?before=<id>`, as anteriores; `?after=<id>`, as que chegaram depois (até
/// 200, para a volta de uma reconexão); `?around=<id>`, metade antes e metade
/// depois dela (ir até uma mensagem antiga). `limit` vai de 1 a 100.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(channel_id): Path<String>,
    query: Result<Query<PageQuery>, QueryRejection>,
) -> Result<Json<MessagePage>, ApiError> {
    let Query(query) = query
        .map_err(|_| ApiError::InvalidRequest("O pedido não está no formato esperado.".into()))?;
    let (cursor, max) = match (query.before, query.after, query.around) {
        (None, None, None) => (Cursor::Latest, PAGE_MAX),
        (Some(before), None, None) => (Cursor::Before(before), PAGE_MAX),
        (None, Some(after), None) => (Cursor::After(after), CATCH_UP_MAX),
        (None, None, Some(around)) => (Cursor::Around(around), PAGE_MAX),
        _ => {
            return Err(ApiError::InvalidRequest(
                "Use só um de before, after e around.".into(),
            ));
        }
    };
    let limit = match query.limit {
        None if matches!(cursor, Cursor::After(_)) => CATCH_UP_MAX,
        None => PAGE_DEFAULT,
        Some(limit) if (1..=max).contains(&limit) => limit,
        Some(_) => {
            return Err(ApiError::InvalidRequest(format!(
                "O limit vai de 1 a {max}."
            )));
        }
    };
    let channel = access::readable(&state.db, &user, &channel_id).await?;
    Ok(Json(
        messages::page(&state.db, channel.id(), cursor, limit).await?,
    ))
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct SendMessageRequest {
    /// Gerado pelo app antes de enviar (um UUID); o mesmo valor não duplica.
    pub client_id: String,
    pub body: String,
    /// A mensagem respondida, do mesmo canal.
    #[serde(default)]
    #[ts(optional)]
    pub reply_to: Option<String>,
    /// Se a resposta menciona quem escreveu a original (o `@` ligado). Padrão: sim.
    #[serde(default)]
    #[ts(optional)]
    pub reply_mention: Option<bool>,
    /// Os ids dos arquivos já enviados (`POST /api/files`), até 10. Com anexo, o texto pode
    /// ser vazio.
    #[serde(default)]
    #[ts(optional)]
    pub attachments: Option<Vec<String>>,
    /// Encaminhar: o id da mensagem original, que quem envia precisa poder ler. Com ele, o
    /// `body`, a resposta e os anexos do pedido não valem: vai o texto e os arquivos da original.
    #[serde(default)]
    #[ts(optional)]
    pub forward: Option<String>,
}

/// `POST /api/channels/{id}/messages`: 201 com a mensagem nova, ou 200 com a
/// que já existia para esse `client_id` (409 se ela é de outro canal). As
/// regras e o limite de envio ficam no [`messages::create`]. Numa conversa
/// privada com quem saiu do grupo, 409.
pub async fn send(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(channel_id): Path<String>,
    ApiJson(request): ApiJson<SendMessageRequest>,
) -> Result<(StatusCode, Json<Message>), ApiError> {
    let channel = access::readable(&state.db, &user, &channel_id).await?;
    if let Readable::Dm(dm) = &channel {
        // A conversa com quem saiu do grupo continua na lista, só para leitura.
        let other = users::get_by_id(&state.db, dm.other(&user.id)).await?;
        if !other.is_active() {
            return Err(ApiError::Conflict("Essa pessoa saiu do grupo.".into()));
        }
    }
    let (message, created) = if let Some(original) = &request.forward {
        let (from, original) = readable_message(&state, &user, original).await?;
        messages::forward(
            &state.db,
            &state.send_limiter,
            &channel,
            &user,
            &request.client_id,
            &original,
            &from,
            now(),
        )
        .await?
    } else {
        messages::create(
            &state.db,
            &state.send_limiter,
            &channel,
            &user,
            &request.client_id,
            &request.body,
            request.reply_to.as_deref().map(|id| messages::ReplyTo {
                id,
                mention: request.reply_mention.unwrap_or(true),
            }),
            request.attachments.as_deref().unwrap_or_default(),
            now(),
        )
        .await?
    };
    let status = if created {
        // Só a nova vai para o WebSocket: a repetida quem devia já recebeu.
        // A de um canal de texto vai para quem acessa o canal (todos, se ele
        // não é restrito); a de uma conversa privada, só para os dois.
        let event = ServerEvent::MessageCreated {
            message: message.clone(),
        };
        publish(&state, &channel, &event).await?;
        spawn_previews(&state, &channel, &message);
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(message)))
}

/// Busca as prévias dos links de `message` em segundo plano (decisão 22 do plano da v0.7) e,
/// se mudaram, manda a mensagem inteira num `message.updated`.
fn spawn_previews(state: &AppState, channel: &Readable, message: &Message) {
    let had = !message.previews.is_empty();
    if !had && crate::previews::meta::links(&message.body).is_empty() {
        return;
    }
    let state = state.clone();
    let channel = channel.clone();
    let id = message.id.clone();
    tokio::spawn(async move {
        let result = async {
            if !crate::previews::refresh(&state.db, &state.files, &state.previews, &id, now())
                .await?
            {
                return Ok(());
            }
            let Some(message) = messages::find(&state.db, &id).await? else {
                return Ok(());
            };
            let event = ServerEvent::MessageUpdated {
                message,
                new_mentions: Vec::new(),
            };
            publish(&state, &channel, &event).await
        }
        .await;
        if let Err(error) = result {
            eprintln!("prévias da mensagem {id}: {error}");
        }
    });
}

/// Manda `event` para quem lê `channel`: num canal de texto, quem acessa o canal
/// (todos, se ele não é restrito); numa conversa privada, só os dois.
async fn publish(
    state: &AppState,
    channel: &Readable,
    event: &ServerEvent,
) -> Result<(), ApiError> {
    match channel {
        Readable::Text(text) => {
            let to = access::audience(&state.db, &text.id).await?;
            state.hub.publish_in(event, to);
        }
        Readable::Dm(dm) => state.hub.publish_to(&dm.members, event),
    }
    Ok(())
}

/// A mensagem `id` e o canal dela, se quem pede lê esse canal. Sem acesso ao
/// canal, a mensagem "não existe" (404), como o canal.
async fn readable_message(
    state: &AppState,
    user: &User,
    id: &str,
) -> Result<(Readable, Message), ApiError> {
    let not_found = || ApiError::NotFound("Essa mensagem não existe mais.".into());
    let message = messages::find(&state.db, id).await?.ok_or_else(not_found)?;
    let channel = access::readable(&state.db, user, &message.channel_id)
        .await
        .map_err(|error| match error {
            ApiError::Forbidden | ApiError::NotFound(_) => not_found(),
            other => other,
        })?;
    Ok((channel, message))
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct EditMessageRequest {
    pub body: String,
}

/// `PATCH /api/messages/{id}`: troca o texto. Só o autor (403); a mensagem vai
/// inteira no `message.updated`.
pub async fn edit(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(request): ApiJson<EditMessageRequest>,
) -> Result<Json<Message>, ApiError> {
    let (channel, message) = readable_message(&state, &user, &id).await?;
    let edited = messages::edit(&state.db, &channel, &user, &message, &request.body, now()).await?;
    let event = ServerEvent::MessageUpdated {
        message: edited.message.clone(),
        new_mentions: edited.new_mentions,
    };
    publish(&state, &channel, &event).await?;
    spawn_previews(&state, &channel, &edited.message);
    Ok(Json(edited.message))
}

/// `DELETE /api/messages/{id}/previews`: o autor tira as prévias da mensagem, de vez (o X no
/// cartão). Responde com a mensagem, que vai também no `message.updated`.
pub async fn hide_previews(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<Message>, ApiError> {
    let (channel, message) = readable_message(&state, &user, &id).await?;
    if message.author.id != user.id {
        return Err(ApiError::Forbidden);
    }
    crate::previews::hide(&state.db, &message.id).await?;
    let message = messages::get(&state.db, &message.id).await?;
    let event = ServerEvent::MessageUpdated {
        message: message.clone(),
        new_mentions: Vec::new(),
    };
    publish(&state, &channel, &event).await?;
    Ok(Json(message))
}

/// `DELETE /api/messages/{id}`: 204. O autor, ou o dono numa mensagem de canal.
pub async fn delete(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let (channel, message) = readable_message(&state, &user, &id).await?;
    if !messages::can_delete(&channel, &user, &message) {
        return Err(ApiError::Forbidden);
    }
    let released = messages::delete(&state.db, &message.id).await?;
    for id in released {
        if let Err(error) = state.files.delete(&id).await {
            eprintln!("arquivo {id}: não deu para apagar do disco: {error}");
        }
    }
    let event = ServerEvent::MessageDeleted {
        channel_id: message.channel_id,
        message_id: message.id,
    };
    publish(&state, &channel, &event).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// `PUT /api/messages/{id}/reactions/{emoji}`: reage (repetir não muda nada).
pub async fn react(
    state: State<AppState>,
    user: CurrentUser,
    path: Path<(String, String)>,
) -> Result<Json<Message>, ApiError> {
    set_reaction(state, user, path, true).await
}

/// `DELETE /api/messages/{id}/reactions/{emoji}`: tira a própria reação.
pub async fn unreact(
    state: State<AppState>,
    user: CurrentUser,
    path: Path<(String, String)>,
) -> Result<Json<Message>, ApiError> {
    set_reaction(state, user, path, false).await
}

async fn set_reaction(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((id, emoji)): Path<(String, String)>,
    on: bool,
) -> Result<Json<Message>, ApiError> {
    let (channel, message) = readable_message(&state, &user, &id).await?;
    let message = messages::react(&state.db, &user, &message, &emoji, on, now()).await?;
    let event = ServerEvent::MessageUpdated {
        message: message.clone(),
        new_mentions: Vec::new(),
    };
    publish(&state, &channel, &event).await?;
    Ok(Json(message))
}

/// `PUT /api/messages/{id}/pin`: fixa. Num canal, só quem gerencia os canais (403); 409 com 50
/// fixadas.
pub async fn pin(
    state: State<AppState>,
    user: CurrentUser,
    path: Path<String>,
) -> Result<Json<Message>, ApiError> {
    set_pin(state, user, path, true).await
}

/// `DELETE /api/messages/{id}/pin`: desafixa.
pub async fn unpin(
    state: State<AppState>,
    user: CurrentUser,
    path: Path<String>,
) -> Result<Json<Message>, ApiError> {
    set_pin(state, user, path, false).await
}

async fn set_pin(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    on: bool,
) -> Result<Json<Message>, ApiError> {
    let (channel, message) = readable_message(&state, &user, &id).await?;
    let changed = messages::set_pinned(&state.db, &channel, &user, &message, on, now()).await?;
    if changed.pinned_at != message.pinned_at {
        let event = ServerEvent::MessageUpdated {
            message: changed.clone(),
            new_mentions: Vec::new(),
        };
        publish(&state, &channel, &event).await?;
    }
    Ok(Json(changed))
}

/// `GET /api/channels/{id}/pins`: as fixadas, da fixada mais recente para a mais antiga.
pub async fn pins(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(channel_id): Path<String>,
) -> Result<Json<Vec<Message>>, ApiError> {
    let channel = access::readable(&state.db, &user, &channel_id).await?;
    Ok(Json(messages::pins(&state.db, channel.id()).await?))
}

/// `GET /api/search`: a busca nos canais de texto que a pessoa lê (as conversas privadas ficam
/// de fora). Sem palavra e sem filtro, 422.
pub async fn search(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    query: Result<Query<SearchQuery>, QueryRejection>,
) -> Result<Json<SearchPage>, ApiError> {
    let Query(query) = query
        .map_err(|_| ApiError::InvalidRequest("O pedido não está no formato esperado.".into()))?;
    Ok(Json(search::search(&state.db, &user, &query).await?))
}
