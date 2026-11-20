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
