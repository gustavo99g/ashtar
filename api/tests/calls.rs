//! Testes de integração das ligações privadas (ADR 0023): a API de verdade numa
//! porta local, as rotas pelo `reqwest` e o tempo real pelo WebSocket.
//!
//! O Kid liga para a Ana; a Bia é a terceira pessoa, que não pode começar,
//! atender, pegar token, nem ficar sabendo de nada.

use std::sync::{Arc, Once};
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
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

const KEY: &str = "chave-de-teste";
const SECRET: &str = "segredo-de-teste-com-32-caracteres";

/// As chaves do LiveKit, para o token da sala sair. O endereço não responde:
/// apagar a sala no fim da ligação só deixa um erro no log.
fn livekit_env() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        // SAFETY: roda uma vez, antes de qualquer teste deste arquivo ler o
        // ambiente (todos passam pelo `setup`).
        unsafe {
            std::env::set_var("LIVEKIT_API_KEY", KEY);
            std::env::set_var("LIVEKIT_API_SECRET", SECRET);
            std::env::set_var("LIVEKIT_URL", "http://127.0.0.1:9");
        }
    });
}

struct Ctx {
    db: SqlitePool,
    base: String,
    http: reqwest::Client,
    owner: User,
    kid: String,
    ana: String,
    bia: String,
    ana_id: String,
    dm: String,
}

/// Sobe a API com o toque de `ring` e abre a conversa do Kid com a Ana.
async fn setup_with(ring: Duration) -> Ctx {
    livekit_env();
    let db = db::connect_in_memory().await.unwrap();
    let owner = users::create_owner(&db, "Kid", now()).await.unwrap();
    let mut state = AppState::new(db.clone(), "https://ashtar.test/");
    state.hub = Arc::new(Hub::new(Duration::from_millis(100)));
    state.webhook = Some(Arc::new(WebhookReceiver::new(TokenVerifier::with_api_key(
        KEY, SECRET,
    ))));
    state.ring_timeout = ring;
    let router = app(state, Arc::new(ClientPolicy::default()));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("127.0.0.1:{}", listener.local_addr().unwrap().port());
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });

    let mut ctx = Ctx {
        db,
        base,
        http: reqwest::Client::new(),
        owner,
        kid: String::new(),
        ana: String::new(),
        bia: String::new(),
        ana_id: String::new(),
        dm: String::new(),
    };
    ctx.kid = join(&ctx, "Kid", 1, true).await;
    ctx.ana = join(&ctx, "Ana", 2, false).await;
    ctx.bia = join(&ctx, "Bia", 3, false).await;
    ctx.ana_id = users::get_active_by_nick(&ctx.db, "Ana").await.unwrap().id;
    let (status, body) = post(
        &ctx,
        "/api/dms",
        Some(&ctx.kid),
        json!({ "user_id": ctx.ana_id }),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    ctx.dm = body["id"].as_str().unwrap().to_owned();
    ctx
}

async fn setup() -> Ctx {
    setup_with(Duration::from_secs(30)).await
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

/// Uma rota de ligação da conversa (`""` é ligar; `"accept"`, `"end"`...).
async fn call(ctx: &Ctx, token: &str, action: &str) -> (u16, Value) {
    let path = if action.is_empty() {
        format!("/api/dms/{}/call", ctx.dm)
    } else {
        format!("/api/dms/{}/call/{action}", ctx.dm)
    };
    post(ctx, &path, Some(token), json!({})).await
}

async fn voice_token(ctx: &Ctx, token: &str, path: &str) -> (u16, Value) {
    post(
        ctx,
        &format!("/api/voice/{path}"),
        Some(token),
        json!({ "channel_id": ctx.dm }),
    )
    .await
}

async fn connect(ctx: &Ctx, token: &str) -> (Socket, Value) {
    let (status, body) = post(ctx, "/api/realtime/ticket", Some(token), json!({})).await;
    assert_eq!(status, 200, "{body}");
    let ticket = body["ticket"].as_str().unwrap();
    let (mut socket, _) = connect_async(format!("ws://{}/api/realtime?ticket={ticket}", ctx.base))
        .await
        .unwrap();
    let ready = next(&mut socket).await;
    assert_eq!(ready["type"], "ready", "{ready}");
    (socket, ready)
}

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

async fn next_of(socket: &mut Socket, kind: &str) -> Value {
    loop {
        let event = next(socket).await;
        if event["type"] == kind {
            return event;
        }
    }
}

/// Os eventos de ligação, de sala e de mensagem que chegaram em `socket` até o
/// `pong` de um `ping` mandado agora (os de presença ficam de fora).
async fn private_events(socket: &mut Socket) -> Vec<Value> {
    socket.send(Message::text("ping")).await.unwrap();
    let mut events = Vec::new();
    loop {
        let event = next(socket).await;
        let kind = event["type"].as_str().unwrap().to_owned();
        if kind == "pong" {
            return events;
        }
        if kind.starts_with("call.") || kind == "voice.participants" || kind == "message.created" {
            events.push(event);
        }
    }
}

/// A conversa como `token` a vê na lista (`GET /api/dms`).
async fn conversation(ctx: &Ctx, token: &str) -> Value {
    let list = get(ctx, "/api/dms", token).await;
    list.as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == ctx.dm.as_str())
        .cloned()
        .unwrap_or(Value::Null)
}

/// A Ana conectada (para poder receber a ligação), o Kid e a Bia também.
async fn three_sockets(ctx: &Ctx) -> (Socket, Socket, Socket) {
    let (kid, _) = connect(ctx, &ctx.kid).await;
    let (ana, _) = connect(ctx, &ctx.ana).await;
    let (bia, _) = connect(ctx, &ctx.bia).await;
    (kid, ana, bia)
}

#[tokio::test]
async fn a_terceira_pessoa_nao_comeca_nao_atende_nem_pega_token() {
    let ctx = setup().await;
    let (_kid, _ana, _bia) = three_sockets(&ctx).await;

    for action in ["", "accept", "decline", "cancel", "end"] {
        let (status, _) = call(&ctx, &ctx.bia, action).await;
        assert_eq!(status, 404, "a Bia em {action:?}");
    }
    let (status, _) = call(&ctx, &ctx.kid, "").await;
    assert_eq!(status, 201);
    let (status, _) = call(&ctx, &ctx.bia, "accept").await;
    assert_eq!(status, 404);
    let (status, _) = call(&ctx, &ctx.ana, "accept").await;
    assert_eq!(status, 200);
    // Atendida, a sala existe, mas não para ela.
    for path in ["token", "screen-token"] {
        let (status, _) = voice_token(&ctx, &ctx.bia, path).await;
        assert_eq!(status, 404, "a Bia no {path}");
    }
    // A conversa também não é uma sala de voz para a lista de quem está nela.
    let (status, _) = ctx
        .http
        .get(format!(
            "http://{}/api/voice/participants?channel_id={}",
            ctx.base, ctx.dm
        ))
        .bearer_auth(&ctx.kid)
        .send()
        .await
        .map(|r| (r.status().as_u16(), ()))
        .unwrap();
    assert_eq!(status, 404);
}

#[tokio::test]
async fn ligar_atender_e_desligar_avisa_so_os_dois() {
    let ctx = setup().await;
    let (mut kid, mut ana, mut bia) = three_sockets(&ctx).await;

    let (status, body) = call(&ctx, &ctx.kid, "").await;
    assert_eq!(status, 201, "{body}");
    assert_eq!(body["outcome"], "ringing");
    assert_eq!(body["caller"]["nick"], "Kid");
    assert_eq!(body["callee"]["nick"], "Ana");
    for socket in [&mut kid, &mut ana] {
        let event = next_of(socket, "call.ringing").await;
        assert_eq!(event["call"]["channel_id"], ctx.dm.as_str());
        assert_eq!(event["call"]["caller"]["nick"], "Kid");
    }

    // Tocando, ainda não há sala.
    let (status, _) = voice_token(&ctx, &ctx.kid, "token").await;
    assert_eq!(status, 409);

    let (status, body) = call(&ctx, &ctx.ana, "accept").await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["outcome"], "answered");
    for socket in [&mut kid, &mut ana] {
        let event = next_of(socket, "call.accepted").await;
        assert_eq!(event["call"]["outcome"], "answered");
    }

    // Atendida: os dois pegam o token da sala, que tem o nome da conversa.
    for token in [&ctx.kid, &ctx.ana] {
        let (status, body) = voice_token(&ctx, token, "token").await;
        assert_eq!(status, 200, "{body}");
        let claims = TokenVerifier::with_api_key(KEY, SECRET)
            .verify(body["token"].as_str().unwrap())
            .unwrap();
        assert_eq!(claims.video.room, ctx.dm);
    }

    let (status, _) = call(&ctx, &ctx.ana, "end").await;
    assert_eq!(status, 204);
    for socket in [&mut kid, &mut ana] {
        let ended = next_of(socket, "call.ended").await;
        assert_eq!(ended["outcome"], "answered");
        assert!(ended["duration"].is_number(), "{ended}");
        let record = next_of(socket, "message.created").await;
        let message = &record["message"];
        assert_eq!(message["kind"], "call");
        assert_eq!(message["body"], "Ligação");
        assert_eq!(
            message["author"]["nick"], "Kid",
            "o registro é de quem ligou"
        );
        assert_eq!(message["call"]["outcome"], "answered");
    }
    // Encerrada, a sala fecha de novo.
    let (status, _) = voice_token(&ctx, &ctx.kid, "token").await;
    assert_eq!(status, 409);
    assert_eq!(private_events(&mut bia).await, Vec::<Value>::new());

    // A atendida não conta como não lida para ninguém.
    assert_eq!(conversation(&ctx, &ctx.ana).await["state"]["unread"], 0);
    assert_eq!(conversation(&ctx, &ctx.kid).await["state"]["unread"], 0);
}

#[tokio::test]
async fn os_dois_ligando_ao_mesmo_tempo_viram_uma_ligacao_so() {
    let ctx = setup().await;
    let (_kid, _ana, _bia) = three_sockets(&ctx).await;

    let (kid, ana) = tokio::join!(call(&ctx, &ctx.kid, ""), call(&ctx, &ctx.ana, ""));
    let mut statuses = [kid.0, ana.0];
    statuses.sort();
    assert_eq!(statuses, [200, 201], "um começa, o outro atende");
    let calls: Vec<(String,)> = sqlx::query_as("SELECT outcome FROM calls")
        .fetch_all(&ctx.db)
        .await
        .unwrap();
    assert_eq!(calls, [("answered".to_owned(),)]);

    // Ligar de novo com a ligação atendida não abre outra.
    let (status, _) = call(&ctx, &ctx.kid, "").await;
    assert_eq!(status, 409);
}

#[tokio::test]
async fn ligar_de_novo_enquanto_toca_e_a_mesma_ligacao() {
    let ctx = setup().await;
    let (_kid, _ana, _bia) = three_sockets(&ctx).await;
    let (status, first) = call(&ctx, &ctx.kid, "").await;
    assert_eq!(status, 201);
    let (status, again) = call(&ctx, &ctx.kid, "").await;
    assert_eq!(status, 200);
    assert_eq!(first["id"], again["id"]);
}

#[tokio::test]
async fn o_tempo_limite_vira_chamada_perdida_nao_lida() {
    let ctx = setup_with(Duration::from_millis(300)).await;
    let (mut kid, mut ana, mut bia) = three_sockets(&ctx).await;

    let (status, _) = call(&ctx, &ctx.kid, "").await;
    assert_eq!(status, 201);
    for socket in [&mut kid, &mut ana] {
        let ended = next_of(socket, "call.ended").await;
        assert_eq!(ended["outcome"], "missed");
        assert_eq!(ended["duration"], Value::Null);
        let record = next_of(socket, "message.created").await;
        assert_eq!(record["message"]["call"]["outcome"], "missed");
    }
    assert_eq!(private_events(&mut bia).await, Vec::<Value>::new());

    // A perdida conta para quem não atendeu, e só para ela.
    assert_eq!(conversation(&ctx, &ctx.ana).await["state"]["unread"], 1);
    assert_eq!(conversation(&ctx, &ctx.kid).await["state"]["unread"], 0);
    // Depois do tempo, atender não acha nada.
    let (status, _) = call(&ctx, &ctx.ana, "accept").await;
    assert_eq!(status, 409);
}

#[tokio::test]
async fn recusar_e_desistir_fecham_o_registro_certo() {
    let ctx = setup().await;
    let (mut kid, _ana, _bia) = three_sockets(&ctx).await;

    // Recusar é de quem recebe; desistir, de quem liga.
    call(&ctx, &ctx.kid, "").await;
    let (status, _) = call(&ctx, &ctx.kid, "decline").await;
    assert_eq!(status, 409);
    let (status, _) = call(&ctx, &ctx.ana, "cancel").await;
    assert_eq!(status, 409);

    let (status, _) = call(&ctx, &ctx.ana, "decline").await;
    assert_eq!(status, 204);
    let ended = next_of(&mut kid, "call.ended").await;
    assert_eq!(ended["outcome"], "declined");
    let record = next_of(&mut kid, "message.created").await;
    assert_eq!(record["message"]["call"]["outcome"], "declined");

    call(&ctx, &ctx.kid, "").await;
    let (status, _) = call(&ctx, &ctx.kid, "cancel").await;
    assert_eq!(status, 204);
    let ended = next_of(&mut kid, "call.ended").await;
    assert_eq!(ended["outcome"], "cancelled");

    // Nada mais tocando: os dois 409.
    let (status, _) = call(&ctx, &ctx.kid, "cancel").await;
    assert_eq!(status, 409);
    let (status, _) = call(&ctx, &ctx.ana, "end").await;
    assert_eq!(status, 409);

    // Recusada e cancelada não contam como não lidas.
    assert_eq!(conversation(&ctx, &ctx.ana).await["state"]["unread"], 0);
    let page = get(
        &ctx,
        &format!("/api/channels/{}/messages", ctx.dm),
        &ctx.ana,
    )
    .await;
    let outcomes: Vec<&str> = page["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["call"]["outcome"].as_str().unwrap())
        .collect();
    assert_eq!(outcomes, ["declined", "cancelled"]);
}

#[tokio::test]
async fn nao_toca_para_quem_esta_offline() {
    let ctx = setup().await;
    let (status, body) = call(&ctx, &ctx.kid, "").await;
    assert_eq!(status, 409, "{body}");
    assert_eq!(body["message"], "Ana está offline agora.");
}

fn signed(body: &str) -> String {
    let hash = base64::engine::general_purpose::STANDARD.encode(Sha256::digest(body));
    AccessToken::with_api_key(KEY, SECRET)
        .with_sha256(&hash)
        .to_jwt()
        .unwrap()
}

async fn webhook(ctx: &Ctx, body: &Value) -> u16 {
    let body = body.to_string();
    ctx.http
        .post(format!("http://{}/webhooks/livekit", ctx.base))
        .header("content-type", "application/webhook+json")
        .header("authorization", signed(&body))
        .body(body)
        .send()
        .await
        .unwrap()
        .status()
        .as_u16()
}

#[tokio::test]
async fn o_webhook_da_sala_privada_nao_chega_a_terceira_conexao() {
    let ctx = setup().await;
    let (mut kid, mut ana, mut bia) = three_sockets(&ctx).await;
    call(&ctx, &ctx.kid, "").await;
    call(&ctx, &ctx.ana, "accept").await;
    next_of(&mut kid, "call.accepted").await;
    next_of(&mut ana, "call.accepted").await;

    let room = json!({ "name": ctx.dm });
    let joined = json!({
        "event": "participant_joined", "room": room, "participant": { "identity": "kid" }
    });
    assert_eq!(webhook(&ctx, &joined).await, 200);
    // A tela que para não encerra.
    let screen_left = json!({
        "event": "participant_left", "room": room, "participant": { "identity": "kid:screen" }
    });
    assert_eq!(webhook(&ctx, &screen_left).await, 200);
    assert_eq!(private_events(&mut bia).await, Vec::<Value>::new());
    assert_eq!(private_events(&mut kid).await, Vec::<Value>::new());

    // A saída da voz de um dos dois encerra a ligação para os dois.
    let left = json!({
        "event": "participant_left", "room": room, "participant": { "identity": ctx.ana_id }
    });
    assert_eq!(webhook(&ctx, &left).await, 200);
    for socket in [&mut kid, &mut ana] {
        let ended = next_of(socket, "call.ended").await;
        assert_eq!(ended["outcome"], "answered");
    }
    // E o fim da sala, depois, não muda nada nem chega a ninguém.
    let finished = json!({ "event": "room_finished", "room": room });
    assert_eq!(webhook(&ctx, &finished).await, 200);
    assert_eq!(private_events(&mut bia).await, Vec::<Value>::new());
    let events = private_events(&mut kid).await;
    assert!(
        events.iter().all(|e| e["type"] != "voice.participants"),
        "{events:?}"
    );
}

#[tokio::test]
async fn o_ready_traz_a_ligacao_em_andamento() {
    let ctx = setup().await;
    let (_kid, _ana, _bia) = three_sockets(&ctx).await;
    call(&ctx, &ctx.kid, "").await;

    let (_again, ready) = connect(&ctx, &ctx.ana).await;
    assert_eq!(ready["call"]["outcome"], "ringing");
    assert_eq!(ready["call"]["caller"]["nick"], "Kid");
    let (_bia_again, ready) = connect(&ctx, &ctx.bia).await;
    assert_eq!(ready["call"], Value::Null);
}

#[tokio::test]
async fn ao_subir_a_api_fecha_as_ligacoes_abertas() {
    let ctx = setup().await;
    let (_kid, _ana, _bia) = three_sockets(&ctx).await;
    call(&ctx, &ctx.kid, "").await;

    assert_eq!(api::calls::close_stale(&ctx.db, now()).await.unwrap(), 1);
    assert_eq!(api::calls::close_stale(&ctx.db, now()).await.unwrap(), 0);
    let outcome: String = sqlx::query_scalar("SELECT outcome FROM calls")
        .fetch_one(&ctx.db)
        .await
        .unwrap();
    assert_eq!(outcome, "missed");
    let records: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE kind = 'call'")
        .fetch_one(&ctx.db)
        .await
        .unwrap();
    assert_eq!(records, 1);
}
