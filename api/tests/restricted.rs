//! Testes de integração dos canais e salas restritos da v0.5 (ADR 0028): quem
//! está fora da lista não acha o canal por nenhuma rota nem recebe nada dele
//! pelo tempo real.

use std::sync::Arc;
use std::time::Duration;

use api::chat::read;
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

/// Cria um canal restrito à lista `members` e devolve o id.
async fn create_restricted(
    ctx: &Ctx,
    kind: &str,
    name: &str,
    category: &str,
    members: &[&str],
) -> String {
    let (status, body) = call(
        &ctx.router,
        "POST",
        "/api/channels",
        Some(&ctx.owner_token),
        Some(json!({
            "kind": kind, "name": name, "category_id": category,
            "restricted": true, "member_ids": members,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["restricted"], true);
    body["id"].as_str().unwrap().to_owned()
}

/// Os ids de todos os canais da lista como `token` a vê.
async fn visible(ctx: &Ctx, token: &str) -> (Vec<String>, Value) {
    let (status, layout) = call(&ctx.router, "GET", "/api/channels", Some(token), None).await;
    assert_eq!(status, StatusCode::OK);
    let mut ids: Vec<String> = layout["top"]
        .as_array()
        .unwrap()
        .iter()
        .chain(
            layout["categories"]
                .as_array()
                .unwrap()
                .iter()
                .flat_map(|c| c["channels"].as_array().unwrap()),
        )
        .map(|c| c["id"].as_str().unwrap().to_owned())
        .collect();
    ids.sort();
    (ids, layout)
}

async fn send(ctx: &Ctx, token: &str, channel: &str, body: &str) -> (StatusCode, Value) {
    call(
        &ctx.router,
        "POST",
        &format!("/api/channels/{channel}/messages"),
        Some(token),
        Some(json!({ "client_id": uuid(), "body": body })),
    )
    .await
}

fn uuid() -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    format!(
        "00000000-0000-7000-8000-{:012x}",
        N.fetch_add(1, Ordering::Relaxed)
    )
}

#[tokio::test]
async fn quem_esta_fora_nao_acha_o_canal_nem_a_sala() {
    let ctx = setup().await;
    let ana = join(&ctx, "Ana", 2, false).await;
    let ana_id = member_id(&ctx, &ana).await;
    let beto = join(&ctx, "Beto", 3, false).await;
    let (status, _) = call(
        &ctx.router,
        "POST",
        "/api/categories",
        Some(&ctx.owner_token),
        Some(json!({ "name": "Staff" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (_, layout) = visible(&ctx, &ctx.owner_token).await;
    let staff_category = layout["categories"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "Staff")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let staff = create_restricted(&ctx, "text", "staff", &staff_category, &[&ana_id]).await;
    let squad = create_restricted(&ctx, "voice", "Squad", &staff_category, &[&ana_id]).await;

    // Ana e o dono veem; o Beto não, nem a categoria, que só tem restritos.
    let (ids, _) = visible(&ctx, &ana).await;
    assert!(ids.contains(&staff) && ids.contains(&squad));
    let (ids, layout) = visible(&ctx, &beto).await;
    assert!(!ids.contains(&staff) && !ids.contains(&squad));
    assert!(
        layout["categories"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c["name"] != "Staff")
    );
    let (ids, layout) = visible(&ctx, &ctx.owner_token).await;
    assert!(ids.contains(&staff));
    let staff_view = layout["categories"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|c| c["channels"].as_array().unwrap())
        .find(|c| c["id"] == staff.as_str())
        .unwrap()
        .clone();
    assert_eq!(staff_view["member_ids"], json!([ana_id]));
    // Quem está na lista também a recebe; o canal aberto não tem lista.
    let (_, layout) = visible(&ctx, &ana).await;
    assert!(
        layout
            .to_string()
            .contains(&format!("\"member_ids\":[\"{ana_id}\"]"))
    );
    let geral = &layout["categories"][0]["channels"][0];
    assert_eq!(geral["id"], "geral");
    assert!(geral.get("member_ids").is_none());

    // O Beto não lê, não escreve, não marca como lido e não entra na sala: 404.
    let uri = format!("/api/channels/{staff}/messages");
    assert_eq!(
        call(&ctx.router, "GET", &uri, Some(&beto), None).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        send(&ctx, &beto, &staff, "oi").await.0,
        StatusCode::NOT_FOUND
    );
    let (status, _) = call(
        &ctx.router,
        "POST",
        "/api/voice/token",
        Some(&beto),
        Some(json!({ "channel_id": squad })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let uri = format!("/api/voice/participants?channel_id={squad}");
    assert_eq!(
        call(&ctx.router, "GET", &uri, Some(&beto), None).await.0,
        StatusCode::NOT_FOUND
    );

    // A Ana escreve.
    assert_eq!(send(&ctx, &ana, &staff, "oi").await.0, StatusCode::CREATED);
}

#[tokio::test]
async fn nada_do_canal_restrito_chega_a_quem_esta_fora() {
    let ctx = setup().await;
    let ana = join(&ctx, "Ana", 2, false).await;
    let ana_id = member_id(&ctx, &ana).await;
    let beto = join(&ctx, "Beto", 3, false).await;
    let beto_id = member_id(&ctx, &beto).await;
    let staff = create_restricted(&ctx, "text", "staff", "texto", &[&ana_id]).await;

    let mut rx = ctx.hub.subscribe();
    let (status, message) = send(&ctx, &ctx.owner_token, &staff, "@Ana e @Beto, olhem").await;
    assert_eq!(status, StatusCode::CREATED, "{message}");
    // A menção ao Beto, que não acessa o canal, não conta.
    assert_eq!(message["mentions"], json!([ana_id]));
    let events = drain(&mut rx);
    let (event, to) = events
        .iter()
        .find(|(e, _)| e["type"] == "message.created")
        .unwrap();
    assert_eq!(event["message"]["channel_id"], staff.as_str());
    assert!(to.includes(&ana_id) && to.includes(&ctx.owner.id));
    assert!(!to.includes(&beto_id));

    // As não lidas e o "Marcar tudo como lido" do Beto não contam o canal.
    let heads = read::heads(&ctx.db, &beto_id).await.unwrap();
    assert!(heads.iter().all(|h| h.channel_id != staff));
    let heads = read::heads(&ctx.db, &ana_id).await.unwrap();
    assert!(
        heads
            .iter()
            .any(|h| h.channel_id == staff && h.state.unread == 1)
    );
    let (_, done) = call(&ctx.router, "POST", "/api/read-all", Some(&beto), None).await;
    assert!(!done.to_string().contains(&staff));
}

#[tokio::test]
async fn sair_da_lista_tira_da_sala_e_mover_respeita_a_lista() {
    let ctx = setup().await;
    let ana = join(&ctx, "Ana", 2, false).await;
    let ana_id = member_id(&ctx, &ana).await;
    let beto = join(&ctx, "Beto", 3, false).await;
    let beto_id = member_id(&ctx, &beto).await;
    let squad = create_restricted(&ctx, "voice", "Squad", "voz", &[&ana_id, &beto_id]).await;
    let vip = create_restricted(&ctx, "voice", "VIP", "voz", &[&ana_id]).await;

    // O Beto está na sala restrita; a lista de quem está nela não vai para fora.
    let to = api::chat::access::audience(&ctx.db, &squad).await.unwrap();
    assert!(to.includes(&beto_id));
    ctx.hub
        .publish_voice_participants(squad.clone(), vec![person(&beto_id)], to);

    // Mover o Beto para uma sala que ele não acessa: 409.
    let (status, _) = call(
        &ctx.router,
        "POST",
        "/api/voice/move",
        Some(&ctx.owner_token),
        Some(json!({ "user_id": beto_id, "channel_id": vip })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Tirar o Beto da lista: ele sai da sala, com o motivo.
    let mut rx = ctx.hub.subscribe();
    let (status, body) = call(
        &ctx.router,
        "PATCH",
        &format!("/api/channels/{squad}"),
        Some(&ctx.owner_token),
        Some(json!({ "restricted": true, "member_ids": [ana_id] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let events = drain(&mut rx);
    assert!(events.iter().any(|(e, _)| e["type"] == "channels.changed"));
    let (event, to) = events
        .iter()
        .find(|(e, _)| e["type"] == "voice.disconnected")
        .expect("o Beto sai da sala");
    assert_eq!(event["reason"], "no_access");
    assert!(to.includes(&beto_id) && !to.includes(&ana_id));
    let to = api::chat::access::audience(&ctx.db, &squad).await.unwrap();
    assert!(!to.includes(&beto_id));

    // Tirar a restrição: é de todos de novo.
    let (status, body) = call(
        &ctx.router,
        "PATCH",
        &format!("/api/channels/{squad}"),
        Some(&ctx.owner_token),
        Some(json!({ "restricted": false })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["restricted"], false);
    let (ids, _) = visible(&ctx, &beto).await;
    assert!(ids.contains(&squad));
}

#[tokio::test]
async fn quem_ganha_gerenciar_canais_ve_os_restritos_e_quem_sai_do_grupo_sai_da_lista() {
    let ctx = setup().await;
    let ana = join(&ctx, "Ana", 2, false).await;
    let ana_id = member_id(&ctx, &ana).await;
    let beto = join(&ctx, "Beto", 3, false).await;
    let beto_id = member_id(&ctx, &beto).await;
    let staff = create_restricted(&ctx, "text", "staff", "texto", &[&ana_id]).await;

    let mut rx = ctx.hub.subscribe();
    let (status, _) = call(
        &ctx.router,
        "PUT",
        &format!("/api/members/{beto_id}/permissions/canais.gerenciar"),
        Some(&ctx.owner_token),
        Some(json!({ "enabled": true })),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(
        drain(&mut rx)
            .iter()
            .any(|(e, _)| e["type"] == "channels.changed")
    );
    let (ids, _) = visible(&ctx, &beto).await;
    assert!(ids.contains(&staff));

    let (status, _) = call(
        &ctx.router,
        "DELETE",
        &format!("/api/members/{ana_id}"),
        Some(&ctx.owner_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let listed = api::chat::access::listed(&ctx.db, &staff).await.unwrap();
    assert!(listed.is_empty());
}

/// A busca (v0.7): acha sem acento e pelo começo da palavra, filtra por quem mandou e nunca
/// mostra o que a pessoa não lê: o canal restrito de fora e as conversas privadas.
#[tokio::test]
async fn a_busca_so_acha_o_que_a_pessoa_le() {
    let ctx = setup().await;
    let ana = join(&ctx, "Ana", 2, false).await;
    let ana_id = member_id(&ctx, &ana).await;
    let beto = join(&ctx, "Beto", 3, false).await;
    let beto_id = member_id(&ctx, &beto).await;
    let staff = create_restricted(&ctx, "text", "staff", "texto", &[&ana_id]).await;

    let (status, _) = send(&ctx, &ana, "geral", "Você vai jogar hoje?").await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, _) = send(&ctx, &ctx.owner_token, "geral", "voce viu o jogo?").await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, _) = send(&ctx, &ana, &staff, "você no staff").await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, dm) = call(
        &ctx.router,
        "POST",
        "/api/dms",
        Some(&ana),
        Some(json!({ "user_id": beto_id })),
    )
    .await;
    assert!(status.is_success(), "{dm}");
    let dm_id = dm["id"].as_str().unwrap().to_owned();
    let (status, _) = send(&ctx, &ana, &dm_id, "você no privado").await;
    assert_eq!(status, StatusCode::CREATED);

    let bodies = |page: &Value| -> Vec<String> {
        page["messages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["body"].as_str().unwrap().to_owned())
            .collect()
    };

    // O Beto não está no staff, e a conversa privada não entra na busca.
    let (status, page) = call(&ctx.router, "GET", "/api/search?q=voce", Some(&beto), None).await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert_eq!(bodies(&page), ["voce viu o jogo?", "Você vai jogar hoje?"]);
    assert_eq!(page["has_more"], false);

    // A Ana está no staff.
    let (_, page) = call(&ctx.router, "GET", "/api/search?q=voc", Some(&ana), None).await;
    assert_eq!(bodies(&page).len(), 3);

    // O começo da palavra, o canal e quem mandou.
    let (_, page) = call(
        &ctx.router,
        "GET",
        "/api/search?q=jog&author=ana",
        Some(&beto),
        None,
    )
    .await;
    assert_eq!(bodies(&page), ["Você vai jogar hoje?"]);
    let uri = format!("/api/search?q=voce&channel_id={staff}");
    let (status, _) = call(&ctx.router, "GET", &uri, Some(&beto), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let uri = format!("/api/search?q=voce&channel_id={dm_id}");
    let (status, _) = call(&ctx.router, "GET", &uri, Some(&ana), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Editar muda o que a busca acha; sem nada para buscar, 422.
    let (_, page) = call(&ctx.router, "GET", "/api/search?q=viu", Some(&beto), None).await;
    let id = page["messages"][0]["id"].as_str().unwrap().to_owned();
    let (status, _) = call(
        &ctx.router,
        "PATCH",
        &format!("/api/messages/{id}"),
        Some(&ctx.owner_token),
        Some(json!({ "body": "partida amanhã" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, page) = call(&ctx.router, "GET", "/api/search?q=viu", Some(&beto), None).await;
    assert!(bodies(&page).is_empty());
    let (_, page) = call(
        &ctx.router,
        "GET",
        "/api/search?q=amanha",
        Some(&beto),
        None,
    )
    .await;
    assert_eq!(bodies(&page), ["partida amanhã"]);
    let (status, _) = call(&ctx.router, "GET", "/api/search?q=", Some(&beto), None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}
