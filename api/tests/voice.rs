//! Testes de integração das salas de voz da v0.5 (ADR 0026): mover alguém e
//! desconectar da voz, pelas rotas de verdade, num banco em memória. O LiveKit
//! não está configurado aqui: quem está em cada sala vem da lista que o hub
//! guarda, publicada pelo próprio teste.

use std::sync::Arc;
use std::time::Duration;

use api::client_policy::ClientPolicy;
use api::db::{self, now};
use api::identity::invites::{self, InviteKind};
use api::identity::{User, users};
use api::realtime::{Audience, Hub, Signal};
use api::voice::ParticipantView;
use api::{AppState, app};
use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::SqlitePool;
use tokio::sync::broadcast;
use tower::ServiceExt;

struct Ctx {
    db: SqlitePool,
    router: Router,
    hub: Arc<Hub>,
    owner: User,
    owner_token: String,
}

async fn setup() -> Ctx {
    let db = db::connect_in_memory().await.unwrap();
    let owner = users::create_owner(&db, "Kid", now()).await.unwrap();
    let mut state = AppState::new(db.clone(), "https://ashtar.test/");
    state.move_grace = Duration::from_millis(20);
    let hub = state.hub.clone();
    let router = app(state, Arc::new(ClientPolicy::default()));
    let mut ctx = Ctx {
        db,
        router,
        hub,
        owner,
        owner_token: String::new(),
    };
    ctx.owner_token = join(&ctx, "Kid", 1, true).await;
    ctx
}

fn key(n: u8) -> String {
    format!("{n:02x}").repeat(32)
}

async fn call(
    router: &Router,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut request = Request::builder().method(method).uri(uri);
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    let body = match body {
        Some(body) => {
            request = request.header("content-type", "application/json");
            Body::from(body.to_string())
        }
        None => Body::empty(),
    };
    let response = router
        .clone()
        .oneshot(request.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// Vincula um computador e devolve o token. O dono entra por uma recuperação.
async fn join(ctx: &Ctx, nick: &str, device: u8, owner: bool) -> String {
    let (kind, target) = if owner {
        (InviteKind::Recovery, Some(&ctx.owner))
    } else {
        (InviteKind::New, None)
    };
    let code = invites::create(&ctx.db, &ctx.owner, kind, target, 3600, 1, now())
        .await
        .unwrap()
        .code;
    let (status, body) = call(
        &ctx.router,
        "POST",
        "/api/auth/redeem",
        None,
        Some(json!({ "code": code, "device_key": key(device), "nick": nick })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["token"].as_str().unwrap().to_owned()
}

async fn member_id(ctx: &Ctx, token: &str) -> String {
    let (_, me) = call(&ctx.router, "GET", "/api/me", Some(token), None).await;
    me["user"]["id"].as_str().unwrap().to_owned()
}

fn person(id: &str) -> ParticipantView {
    ParticipantView {
        user_id: id.into(),
        nick: id.into(),
        display_name: None,
        screen_sharing: false,
        avatar: None,
        ..ParticipantView::default()
    }
}

/// Uma segunda sala de voz, a Squad, criada pelo dono.
async fn create_squad(ctx: &Ctx) -> String {
    let (status, body) = call(
        &ctx.router,
        "POST",
        "/api/channels",
        Some(&ctx.owner_token),
        Some(json!({ "kind": "voice", "name": "Squad", "category_id": "voz" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["id"].as_str().unwrap().to_owned()
}

/// Os eventos já publicados, em JSON, com quem os recebe.
fn drain(rx: &mut broadcast::Receiver<Signal>) -> Vec<(Value, Audience)> {
    let mut events = Vec::new();
    while let Ok(signal) = rx.try_recv() {
        if let Signal::Event { json, to } = signal {
            events.push((serde_json::from_str(json.as_str()).unwrap(), to));
        }
    }
    events
}

#[tokio::test]
async fn mover_manda_o_evento_so_para_quem_foi_movido() {
    let ctx = setup().await;
    let squad = create_squad(&ctx).await;
    let ana = join(&ctx, "Ana", 2, false).await;
    let ana_id = member_id(&ctx, &ana).await;
    let owner_id = ctx.owner.id.clone();
    ctx.hub.publish_voice_participants(
        "sala".into(),
        vec![person(&ana_id), person(&owner_id)],
        Audience::Everyone,
    );
    let mut rx = ctx.hub.subscribe();

    let (status, body) = call(
        &ctx.router,
        "POST",
        "/api/voice/move",
        Some(&ctx.owner_token),
        Some(json!({ "user_id": ana_id, "channel_id": squad })),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    let events = drain(&mut rx);
    assert_eq!(events.len(), 1);
    let (event, to) = &events[0];
    assert!(to.includes(&ana_id) && !to.includes(&owner_id));
    assert_eq!(
        *event,
        json!({ "type": "voice.moved", "channel_id": squad, "by": owner_id, "by_name": "Kid" })
    );
}

#[tokio::test]
async fn mover_confere_a_permissao_a_sala_e_onde_a_pessoa_esta() {
    let ctx = setup().await;
    let squad = create_squad(&ctx).await;
    let ana = join(&ctx, "Ana", 2, false).await;
    let ana_id = member_id(&ctx, &ana).await;
    let beto = join(&ctx, "Beto", 3, false).await;
    let beto_id = member_id(&ctx, &beto).await;
    let move_to = |token: String, user_id: String, channel_id: String| {
        let router = ctx.router.clone();
        async move {
            call(
                &router,
                "POST",
                "/api/voice/move",
                Some(&token),
                Some(json!({ "user_id": user_id, "channel_id": channel_id })),
            )
            .await
            .0
        }
    };

    // Fora de qualquer sala: 409. Ninguém na lista do hub, e o LiveKit não está aqui.
    let owner = ctx.owner_token.clone();
    assert_eq!(
        move_to(owner.clone(), ana_id.clone(), squad.clone()).await,
        StatusCode::CONFLICT
    );

    ctx.hub
        .publish_voice_participants("sala".into(), vec![person(&ana_id)], Audience::Everyone);
    // Sem "Mover membros": 403.
    assert_eq!(
        move_to(beto.clone(), ana_id.clone(), squad.clone()).await,
        StatusCode::FORBIDDEN
    );
    // Já na sala de destino: 409. Canal de texto e sala inventada: 404.
    assert_eq!(
        move_to(owner.clone(), ana_id.clone(), "sala".into()).await,
        StatusCode::CONFLICT
    );
    assert_eq!(
        move_to(owner.clone(), ana_id.clone(), "geral".into()).await,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        move_to(owner.clone(), ana_id.clone(), "nao-existe".into()).await,
        StatusCode::NOT_FOUND
    );
    // Membro inventado: 404.
    assert_eq!(
        move_to(owner.clone(), "ninguem".into(), squad.clone()).await,
        StatusCode::NOT_FOUND
    );

    // Com a permissão dada pelo dono, o Beto move.
    sqlx::query(
        "INSERT INTO user_permissions (user_id, permission, granted_at) VALUES (?, 'membros.mover', 0)",
    )
    .bind(&beto_id)
    .execute(&ctx.db)
    .await
    .unwrap();
    assert_eq!(
        move_to(beto.clone(), ana_id.clone(), squad.clone()).await,
        StatusCode::NO_CONTENT
    );
    let (_, me) = call(&ctx.router, "GET", "/api/me", Some(&beto), None).await;
    assert_eq!(me["can_move_members"], true);
    let (_, me) = call(&ctx.router, "GET", "/api/me", Some(&ana), None).await;
    assert_eq!(me["can_move_members"], false);
}

#[tokio::test]
async fn desconectar_avisa_a_pessoa_de_quem_tirou() {
    let ctx = setup().await;
    let ana = join(&ctx, "Ana", 2, false).await;
    let ana_id = member_id(&ctx, &ana).await;

    let disconnect = |token: String| {
        let router = ctx.router.clone();
        let ana_id = ana_id.clone();
        async move {
            call(
                &router,
                "POST",
                "/api/voice/disconnect",
                Some(&token),
                Some(json!({ "user_id": ana_id })),
            )
            .await
            .0
        }
    };
    assert_eq!(
        disconnect(ctx.owner_token.clone()).await,
        StatusCode::CONFLICT,
        "fora de qualquer sala"
    );

    ctx.hub
        .publish_voice_participants("sala".into(), vec![person(&ana_id)], Audience::Everyone);
    assert_eq!(disconnect(ana.clone()).await, StatusCode::FORBIDDEN);
    let mut rx = ctx.hub.subscribe();
    assert_eq!(
        disconnect(ctx.owner_token.clone()).await,
        StatusCode::NO_CONTENT
    );
    let events = drain(&mut rx);
    assert_eq!(events.len(), 1);
    let (event, to) = &events[0];
    assert_eq!(
        *event,
        json!({ "type": "voice.disconnected", "by": ctx.owner.id, "by_name": "Kid", "reason": "moderator" })
    );
    assert!(to.includes(&ana_id) && !to.includes(&ctx.owner.id));
}

#[tokio::test]
async fn a_transmissao_que_o_app_conta_vai_para_quem_esta_fora() {
    let ctx = setup().await;
    let ana = join(&ctx, "Ana", 2, false).await;
    let ana_id = member_id(&ctx, &ana).await;
    ctx.hub
        .publish_voice_participants("sala".into(), vec![person(&ana_id)], Audience::Everyone);
    let mut rx = ctx.hub.subscribe();
    let long = "x".repeat(300);

    let (status, body) = call(
        &ctx.router,
        "PUT",
        "/api/voice/state",
        Some(&ana),
        Some(json!({
            "channel_id": "sala",
            "mic_off": false,
            "deafened": false,
            "camera": false,
            "sharing": true,
            "share": {
                "title": long,
                "window": true,
                "quality": "1080p60",
                "started_at": 1_700_000_000_000_i64,
                "viewers": 2,
            },
        })),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    let events = drain(&mut rx);
    let share = &events[0].0["participants"][0]["share"];
    assert_eq!(share["quality"], "1080p60");
    assert_eq!(share["viewers"], 2);
    assert_eq!(share["started_at"], 1_700_000_000_000_i64);
    // O título longo é cortado.
    assert_eq!(share["title"].as_str().unwrap().chars().count(), 120);

    // Parou de transmitir: a transmissão some, mesmo que o app ainda mande os dados.
    let (status, _) = call(
        &ctx.router,
        "PUT",
        "/api/voice/state",
        Some(&ana),
        Some(json!({
            "channel_id": "sala",
            "mic_off": false,
            "deafened": false,
            "camera": false,
            "sharing": false,
            "share": { "title": "Tela 1", "window": false, "quality": "720p60", "started_at": 1, "viewers": 0 },
        })),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let events = drain(&mut rx);
    assert!(events[0].0["participants"][0].get("share").is_none());
}

#[tokio::test]
async fn o_estado_que_o_app_conta_vai_para_quem_esta_fora() {
    let ctx = setup().await;
    let ana = join(&ctx, "Ana", 2, false).await;
    let ana_id = member_id(&ctx, &ana).await;
    let owner_id = ctx.owner.id.clone();
    ctx.hub.publish_voice_participants(
        "sala".into(),
        vec![person(&ana_id), person(&owner_id)],
        Audience::Everyone,
    );
    let mut rx = ctx.hub.subscribe();

    let (status, body) = call(
        &ctx.router,
        "PUT",
        "/api/voice/state",
        Some(&ana),
        Some(json!({
            "channel_id": "sala",
            "mic_off": true,
            "deafened": true,
            "camera": true,
            "sharing": false,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    let events = drain(&mut rx);
    assert_eq!(events.len(), 1);
    let (event, to) = &events[0];
    assert!(to.includes(&owner_id));
    assert_eq!(event["type"], "voice.participants");
    let people = event["participants"].as_array().unwrap();
    assert_eq!(people[0]["user_id"], ana_id);
    assert_eq!(people[0]["mic_off"], true);
    assert_eq!(people[0]["deafened"], true);
    assert_eq!(people[0]["camera"], true);
    assert_eq!(people[1]["mic_off"], false);

    // A próxima lista do LiveKit (um webhook) continua com o estado de Ana.
    ctx.hub.publish_voice_participants(
        "sala".into(),
        vec![person(&ana_id), person(&owner_id)],
        Audience::Everyone,
    );
    let events = drain(&mut rx);
    assert_eq!(events[0].0["participants"][0]["deafened"], true);

    // Uma sala que não existe: 404.
    let (status, _) = call(
        &ctx.router,
        "PUT",
        "/api/voice/state",
        Some(&ana),
        Some(json!({
            "channel_id": "nada",
            "mic_off": false,
            "deafened": false,
            "camera": false,
            "sharing": false,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Saiu: o estado é esquecido.
    let (status, _) = call(
        &ctx.router,
        "DELETE",
        "/api/voice/state?channel_id=sala",
        Some(&ana),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    ctx.hub
        .publish_voice_participants("sala".into(), vec![person(&ana_id)], Audience::Everyone);
    let events = drain(&mut rx);
    assert_eq!(
        events.last().unwrap().0["participants"][0]["deafened"],
        false
    );
}

/// Dá "Moderar voz" a `user_id`, como o dono faria em Membros.
async fn grant_moderation(ctx: &Ctx, user_id: &str) {
    sqlx::query(
        "INSERT INTO user_permissions (user_id, permission, granted_at) VALUES (?, 'voz.moderar', 0)",
    )
    .bind(user_id)
    .execute(&ctx.db)
    .await
    .unwrap();
}

#[tokio::test]
async fn silenciar_confere_a_permissao_o_dono_e_a_sala() {
    let ctx = setup().await;
    let ana = join(&ctx, "Ana", 2, false).await;
    let ana_id = member_id(&ctx, &ana).await;
    let beto = join(&ctx, "Beto", 3, false).await;
    let beto_id = member_id(&ctx, &beto).await;
    let moderate = |method: &'static str, token: String, path: String| {
        let router = ctx.router.clone();
        async move { call(&router, method, &path, Some(&token), None).await.0 }
    };
    let mute = |id: &str| format!("/api/voice/moderation/{id}/mute");

    // Fora de qualquer sala de voz do grupo (numa ligação privada também): 404.
    assert_eq!(
        moderate("PUT", ctx.owner_token.clone(), mute(&ana_id)).await,
        StatusCode::NOT_FOUND
    );
    ctx.hub.publish_voice_participants(
        "sala".into(),
        vec![person(&ana_id), person(&beto_id), person(&ctx.owner.id)],
        Audience::Everyone,
    );
    // Sem "Moderar voz": 403. Nem "Mover membros" serve.
    assert_eq!(
        moderate("PUT", beto.clone(), mute(&ana_id)).await,
        StatusCode::FORBIDDEN
    );
    grant_moderation(&ctx, &beto_id).await;
    let (_, me) = call(&ctx.router, "GET", "/api/me", Some(&beto), None).await;
    assert_eq!(me["can_moderate_voice"], true);
    // Ninguém modera o dono, nem a si mesmo; membro inventado é 404.
    assert_eq!(
        moderate("PUT", beto.clone(), mute(&ctx.owner.id)).await,
        StatusCode::CONFLICT
    );
    assert_eq!(
        moderate("PUT", beto.clone(), mute(&beto_id)).await,
        StatusCode::CONFLICT
    );
    assert_eq!(
        moderate("PUT", beto.clone(), mute("ninguem")).await,
        StatusCode::NOT_FOUND
    );
    for action in ["camera-off", "stop-share"] {
        assert_eq!(
            moderate(
                "POST",
                beto.clone(),
                format!("/api/voice/moderation/{}/{action}", ctx.owner.id)
            )
            .await,
            StatusCode::CONFLICT
        );
    }
}

#[tokio::test]
async fn silenciado_fica_ate_liberar_e_so_o_icone_muda() {
    let ctx = setup().await;
    let ana = join(&ctx, "Ana", 2, false).await;
    let ana_id = member_id(&ctx, &ana).await;
    ctx.hub.publish_voice_participants(
        "sala".into(),
        vec![person(&ana_id), person(&ctx.owner.id)],
        Audience::Everyone,
    );
    let mut rx = ctx.hub.subscribe();

    let path = format!("/api/voice/moderation/{ana_id}/mute");
    let (status, body) = call(&ctx.router, "PUT", &path, Some(&ctx.owner_token), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    let events = drain(&mut rx);
    assert_eq!(events.len(), 2);
    let (moderated, to) = &events[0];
    assert!(to.includes(&ana_id) && !to.includes(&ctx.owner.id));
    assert_eq!(
        *moderated,
        json!({
            "type": "voice.moderated", "action": "mute", "server_muted": true,
            "server_deafened": false, "by": ctx.owner.id, "by_name": "Kid",
        })
    );
    let (list, to) = &events[1];
    assert!(to.includes(&ctx.owner.id));
    assert_eq!(list["type"], "voice.participants");
    assert_eq!(list["participants"][0]["server_muted"], true);
    assert_eq!(list["participants"][1]["server_muted"], false);

    // Trocar de sala não solta: o estado está no banco, e a lista nova (do LiveKit) traz ele.
    let imposed = api::moderation::get(&ctx.db, &ana_id).await.unwrap();
    assert!(imposed.mic_muted && !imposed.deafened);
    let room = vec![api::voice::RoomParticipant {
        identity: ana_id.clone(),
        screen_sharing: false,
    }];
    let views = api::voice::join_participants(&ctx.db, room).await.unwrap();
    assert!(views[0].server_muted);

    // Liberar vale mesmo fora da sala.
    ctx.hub
        .publish_voice_participants("sala".into(), vec![], Audience::Everyone);
    let (status, _) = call(&ctx.router, "DELETE", &path, Some(&ctx.owner_token), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(
        api::moderation::get(&ctx.db, &ana_id)
            .await
            .unwrap()
            .is_free()
    );
}

#[tokio::test]
async fn encerrar_a_transmissao_avisa_so_quem_transmitia() {
    let ctx = setup().await;
    let ana = join(&ctx, "Ana", 2, false).await;
    let ana_id = member_id(&ctx, &ana).await;
    ctx.hub
        .publish_voice_participants("sala".into(), vec![person(&ana_id)], Audience::Everyone);
    let mut rx = ctx.hub.subscribe();
    let (status, _) = call(
        &ctx.router,
        "POST",
        &format!("/api/voice/moderation/{ana_id}/stop-share"),
        Some(&ctx.owner_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let events = drain(&mut rx);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].0["action"], "stop_share");
    assert!(events[0].1.includes(&ana_id) && !events[0].1.includes(&ctx.owner.id));
}
