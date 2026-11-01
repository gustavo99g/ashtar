//! Testes de integração do tempo real: a API de verdade numa porta local, o
//! WebSocket pelo `tokio-tungstenite` e as rotas pelo `reqwest`.

use std::sync::Arc;
use std::time::Duration;

use api::client_policy::ClientPolicy;
use api::db::{self, now};
use api::identity::invites::{self, InviteKind};
use api::identity::{User, users};
use api::realtime::Hub;
use api::{AppState, app};
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use livekit_api::access_token::{AccessToken, TokenVerifier};
use livekit_api::webhooks::WebhookReceiver;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

const WEBHOOK_KEY: &str = "chave-de-teste";
const WEBHOOK_SECRET: &str = "segredo-de-teste-com-32-caracteres";

struct Ctx {
    db: SqlitePool,
    base: String,
    http: reqwest::Client,
    owner: User,
    owner_token: String,
}

/// Sobe a API numa porta livre, com o atraso de offline curto e o webhook com
/// chaves de teste.
async fn setup() -> Ctx {
    let db = db::connect_in_memory().await.unwrap();
    let owner = users::create_owner(&db, "Kid", now()).await.unwrap();
    let mut state = AppState::new(db.clone(), "https://ashtar.test/");
    state.hub = Arc::new(Hub::new(Duration::from_millis(100)));
    state.webhook = Some(Arc::new(WebhookReceiver::new(TokenVerifier::with_api_key(
        WEBHOOK_KEY,
        WEBHOOK_SECRET,
    ))));
    let router = app(state, Arc::new(ClientPolicy::default()));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("127.0.0.1:{}", listener.local_addr().unwrap().port());
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });

    let mut ctx = Ctx {
        db,
        base,
        http: reqwest::Client::new(),
        owner,
        owner_token: String::new(),
    };
    ctx.owner_token = join(&ctx, "Kid", 1, true).await;
    ctx
}

fn key(n: u8) -> String {
    format!("{n:02x}").repeat(32)
}

async fn post(ctx: &Ctx, path: &str, token: Option<&str>, body: Value) -> (u16, Value) {
    let mut request = ctx
        .http
        .post(format!("http://{}{path}", ctx.base))
        .json(&body);
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    let response = request.send().await.unwrap();
    let status = response.status().as_u16();
    (status, response.json().await.unwrap_or(Value::Null))
}

async fn get(ctx: &Ctx, path: &str, token: &str) -> Value {
    ctx.http
        .get(format!("http://{}{path}", ctx.base))
        .bearer_auth(token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap()
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
    let (status, body) = post(
        ctx,
        "/api/auth/redeem",
        None,
        json!({ "code": code, "device_key": key(device), "nick": nick }),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    body["token"].as_str().unwrap().to_owned()
}

async fn ticket(ctx: &Ctx, token: &str) -> String {
    let (status, body) = post(ctx, "/api/realtime/ticket", Some(token), json!({})).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["expires_in"], 30);
    body["ticket"].as_str().unwrap().to_owned()
}

/// Conecta e já lê o `ready`.
async fn connect(ctx: &Ctx, token: &str) -> (Socket, Value) {
    let ticket = ticket(ctx, token).await;
    let (mut socket, _) = connect_async(format!("ws://{}/api/realtime?ticket={ticket}", ctx.base))
        .await
        .unwrap();
    let ready = next(&mut socket).await;
    assert_eq!(ready["type"], "ready", "{ready}");
    (socket, ready)
}

/// O próximo evento em JSON, em até 2 segundos.
async fn next(socket: &mut Socket) -> Value {
    loop {
        let message = tokio::time::timeout(Duration::from_secs(2), socket.next())
            .await
            .expect("nenhum evento em 2 segundos")
            .expect("a conexão fechou")
            .unwrap();
        if let Message::Text(text) = message {
            return serde_json::from_str(text.as_str()).unwrap();
        }
    }
}

/// O próximo evento com esse `type`, pulando os outros.
async fn next_of(socket: &mut Socket, kind: &str) -> Value {
    loop {
        let event = next(socket).await;
        if event["type"] == kind {
            return event;
        }
    }
}

fn user_id(ready: &Value) -> String {
    ready["user_id"].as_str().unwrap().to_owned()
}

#[tokio::test]
async fn o_ticket_abre_uma_conexao_so() {
    let ctx = setup().await;
    let ticket = ticket(&ctx, &ctx.owner_token).await;
    let url = format!("ws://{}/api/realtime?ticket={ticket}", ctx.base);

    let (mut socket, _) = connect_async(&url).await.unwrap();
    let ready = next(&mut socket).await;
    assert_eq!(ready["type"], "ready");
    assert_eq!(ready["user_id"], ctx.owner.id.as_str());
    assert_eq!(ready["online"], json!([ctx.owner.id]));
    assert_eq!(
        ready["channels"],
        json!([{ "channel_id": "geral", "last_message_id": null }])
    );

    // O mesmo ticket de novo, um inventado e nenhum: 401 antes do upgrade.
    for url in [
        url,
        format!("ws://{}/api/realtime?ticket=inventado", ctx.base),
        format!("ws://{}/api/realtime", ctx.base),
    ] {
        let error = connect_async(&url).await.unwrap_err();
        let tokio_tungstenite::tungstenite::Error::Http(response) = error else {
            panic!("esperava a recusa por HTTP: {error:?}");
        };
        assert_eq!(response.status(), 401);
    }
}

#[tokio::test]
async fn sem_sessao_nao_ganha_ticket() {
    let ctx = setup().await;
    let (status, _) = post(&ctx, "/api/realtime/ticket", None, json!({})).await;
    assert_eq!(status, 401);
}

#[tokio::test]
async fn o_ready_traz_a_ultima_mensagem_de_cada_canal() {
    let ctx = setup().await;
    let (status, sent) = post(
        &ctx,
        "/api/channels/geral/messages",
        Some(&ctx.owner_token),
        json!({ "client_id": "c1", "body": "oi" }),
    )
    .await;
    assert_eq!(status, 201);
    let (_, ready) = connect(&ctx, &ctx.owner_token).await;
    assert_eq!(
        ready["channels"],
        json!([{ "channel_id": "geral", "last_message_id": sent["id"] }])
    );
}

#[tokio::test]
async fn ping_recebe_pong() {
    let ctx = setup().await;
    let (mut socket, _) = connect(&ctx, &ctx.owner_token).await;
    socket.send(Message::text("ping")).await.unwrap();
    assert_eq!(next(&mut socket).await, json!({ "type": "pong" }));
}

#[tokio::test]
async fn a_mensagem_nova_chega_em_todos() {
    let ctx = setup().await;
    let ana = join(&ctx, "Ana", 2, false).await;
    let (mut kid_socket, _) = connect(&ctx, &ctx.owner_token).await;
    let (mut ana_socket, _) = connect(&ctx, &ana).await;

    let send = json!({ "client_id": "c1", "body": "oi" });
    let (status, _) = post(
        &ctx,
        "/api/channels/geral/messages",
        Some(&ana),
        send.clone(),
    )
    .await;
    assert_eq!(status, 201);
    for socket in [&mut kid_socket, &mut ana_socket] {
        let event = next_of(socket, "message.created").await;
        assert_eq!(event["message"]["body"], "oi");
        assert_eq!(event["message"]["author"]["nick"], "Ana");
    }

    // O reenvio com o mesmo client_id não vai de novo: o próximo evento é o pong.
    let (status, _) = post(&ctx, "/api/channels/geral/messages", Some(&ana), send).await;
    assert_eq!(status, 200);
    kid_socket.send(Message::text("ping")).await.unwrap();
    let event = next_of(&mut kid_socket, "pong").await;
    assert_eq!(event["type"], "pong");
}

#[tokio::test]
async fn presenca_entra_na_hora_e_sai_depois_do_atraso() {
    let ctx = setup().await;
    let ana = join(&ctx, "Ana", 2, false).await;
    let (mut kid_socket, _) = connect(&ctx, &ctx.owner_token).await;

    let (ana_socket, ana_ready) = connect(&ctx, &ana).await;
    let ana_id = user_id(&ana_ready);
    let online = next_of(&mut kid_socket, "presence.changed").await;
    assert_eq!(
        online,
        json!({ "type": "presence.changed", "user_id": ana_id, "online": true })
    );

    let people = get(&ctx, "/api/people", &ctx.owner_token).await;
    assert!(
        people
            .as_array()
            .unwrap()
            .iter()
            .all(|p| p["online"] == true)
    );

    drop(ana_socket);
    let offline = next_of(&mut kid_socket, "presence.changed").await;
    assert_eq!(offline["user_id"], ana_id.as_str());
    assert_eq!(offline["online"], false);
    let people = get(&ctx, "/api/people", &ctx.owner_token).await;
    let ana_row = people
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == ana_id.as_str())
        .unwrap();
    assert_eq!(ana_row["online"], false);
}

#[tokio::test]
async fn quem_entra_no_grupo_aparece_para_todos() {
    let ctx = setup().await;
    let (mut socket, _) = connect(&ctx, &ctx.owner_token).await;
    join(&ctx, "Ana", 2, false).await;
    let event = next_of(&mut socket, "member.joined").await;
    assert_eq!(event["person"]["nick"], "Ana");
    assert_eq!(event["person"]["is_owner"], false);
}

#[tokio::test]
async fn remover_fecha_com_4001_e_avisa_os_outros() {
    let ctx = setup().await;
    let ana = join(&ctx, "Ana", 2, false).await;
    let (mut kid_socket, _) = connect(&ctx, &ctx.owner_token).await;
    let (mut ana_socket, ana_ready) = connect(&ctx, &ana).await;
    let ana_id = user_id(&ana_ready);

    let response = ctx
        .http
        .delete(format!("http://{}/api/members/{ana_id}", ctx.base))
        .bearer_auth(&ctx.owner_token)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 204);

    let closed = loop {
        match tokio::time::timeout(Duration::from_secs(2), ana_socket.next())
            .await
            .unwrap()
        {
            Some(Ok(Message::Close(frame))) => break frame.unwrap(),
            Some(Ok(_)) => continue,
            other => panic!("esperava o fechamento: {other:?}"),
        }
    };
    assert_eq!(closed.code, CloseCode::Library(4001));

    let left = next_of(&mut kid_socket, "member.left").await;
    assert_eq!(left["user_id"], ana_id.as_str());
    // Sem sessão, o app da Ana não ganha ticket novo.
    let (status, _) = post(&ctx, "/api/realtime/ticket", Some(&ana), json!({})).await;
    assert_eq!(status, 401);
}

fn signed(body: &str) -> String {
    let hash = base64::engine::general_purpose::STANDARD.encode(Sha256::digest(body));
    AccessToken::with_api_key(WEBHOOK_KEY, WEBHOOK_SECRET)
        .with_sha256(&hash)
        .to_jwt()
        .unwrap()
}

async fn webhook(ctx: &Ctx, body: &str, auth: &str) -> u16 {
    ctx.http
        .post(format!("http://{}/webhooks/livekit", ctx.base))
        .header("content-type", "application/webhook+json")
        .header("authorization", auth)
        .body(body.to_owned())
        .send()
        .await
        .unwrap()
        .status()
        .as_u16()
}

#[tokio::test]
async fn webhook_sem_assinatura_certa_e_recusado() {
    let ctx = setup().await;
    let body = json!({ "event": "room_finished", "room": { "name": "sala" } }).to_string();
    assert_eq!(webhook(&ctx, &body, "").await, 401);
    assert_eq!(webhook(&ctx, &body, &signed("outro corpo")).await, 401);
    let other_key = AccessToken::with_api_key("outra", WEBHOOK_SECRET)
        .to_jwt()
        .unwrap();
    assert_eq!(webhook(&ctx, &body, &other_key).await, 401);
}

#[tokio::test]
async fn sala_fechada_manda_a_lista_vazia() {
    let ctx = setup().await;
    let (mut socket, _) = connect(&ctx, &ctx.owner_token).await;
    let body = json!({ "event": "room_finished", "room": { "name": "sala" } }).to_string();
    assert_eq!(webhook(&ctx, &body, &signed(&body)).await, 200);
    let event = next_of(&mut socket, "voice.participants").await;
    assert_eq!(
        event,
        json!({ "type": "voice.participants", "channel_id": "sala", "participants": [] })
    );
}
