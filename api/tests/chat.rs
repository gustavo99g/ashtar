//! Testes de integração do chat: histórico, envio e a lista de pessoas, pelas
//! rotas de verdade, num banco em memória.

use std::sync::Arc;
use std::time::Duration;

use api::chat::access::Readable;
use api::client_policy::ClientPolicy;
use api::db::{self, now};
use api::identity::invites::{self, InviteKind};
use api::identity::{User, users};
use api::limiter::SendLimiter;
use api::{AppState, app};
use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::SqlitePool;
use tower::ServiceExt;

struct Ctx {
    db: SqlitePool,
    router: Router,
    owner: User,
    owner_token: String,
}

async fn setup() -> Ctx {
    let db = db::connect_in_memory().await.unwrap();
    let owner = users::create_owner(&db, "Kid", now()).await.unwrap();
    let router = app(
        AppState::new(db.clone(), "https://ashtar.test/"),
        Arc::new(ClientPolicy::default()),
    );
    let mut ctx = Ctx {
        db,
        router,
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

async fn send(ctx: &Ctx, token: &str, client_id: &str, body: &str) -> (StatusCode, Value) {
    call(
        &ctx.router,
        "POST",
        "/api/channels/geral/messages",
        Some(token),
        Some(json!({ "client_id": client_id, "body": body })),
    )
    .await
}

/// Grava `n` mensagens direto pelas regras, com um limite de envio que não trava.
async fn seed(ctx: &Ctx, n: usize) {
    let channel = api::chat::channels::get_open_text(&ctx.db, "geral")
        .await
        .unwrap();
    let channel = Readable::Text(channel);
    let limiter = SendLimiter::new(usize::MAX, Duration::from_secs(1));
    for i in 0..n {
        api::chat::messages::create(
            &ctx.db,
            &limiter,
            &channel,
            &ctx.owner,
            &format!("seed-{i}"),
            &format!("mensagem {i}"),
            None,
            &[],
            now(),
        )
        .await
        .unwrap();
    }
}

fn bodies(page: &Value) -> Vec<String> {
    page["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["body"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn enviar_e_ler_de_volta() {
    let ctx = setup().await;
    let token = join(&ctx, "Fulano", 2, false).await;

    let (status, message) = send(&ctx, &token, "c-1", "  oi, galera  ").await;
    assert_eq!(status, StatusCode::CREATED, "{message}");
    assert_eq!(message["body"], "oi, galera");
    assert_eq!(message["channel_id"], "geral");
    assert_eq!(message["client_id"], "c-1");
    assert_eq!(message["author"]["nick"], "Fulano");
    assert_eq!(message["author"]["removed"], false);

    let (status, page) = call(
        &ctx.router,
        "GET",
        "/api/channels/geral/messages",
        Some(&ctx.owner_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bodies(&page), ["oi, galera"]);
    assert_eq!(page["has_more"], false);
}

#[tokio::test]
async fn o_mesmo_client_id_nao_duplica() {
    let ctx = setup().await;
    let (status, first) = send(&ctx, &ctx.owner_token, "c-1", "oi").await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, again) = send(&ctx, &ctx.owner_token, "c-1", "oi").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(first["id"], again["id"]);

    let (_, page) = call(
        &ctx.router,
        "GET",
        "/api/channels/geral/messages",
        Some(&ctx.owner_token),
        None,
    )
    .await;
    assert_eq!(bodies(&page).len(), 1);
}

#[tokio::test]
async fn paginas_para_tras_e_para_frente() {
    let ctx = setup().await;
    seed(&ctx, 7).await;
    let uri = "/api/channels/geral/messages";
    let token = Some(ctx.owner_token.as_str());

    // As 3 mais novas, da mais antiga para a mais nova.
    let (_, latest) = call(&ctx.router, "GET", &format!("{uri}?limit=3"), token, None).await;
    assert_eq!(bodies(&latest), ["mensagem 4", "mensagem 5", "mensagem 6"]);
    assert_eq!(latest["has_more"], true);

    // Rolar para cima a partir da mais antiga da página.
    let oldest = latest["messages"][0]["id"].as_str().unwrap();
    let (_, before) = call(
        &ctx.router,
        "GET",
        &format!("{uri}?before={oldest}&limit=3"),
        token,
        None,
    )
    .await;
    assert_eq!(bodies(&before), ["mensagem 1", "mensagem 2", "mensagem 3"]);
    assert_eq!(before["has_more"], true);

    // A volta de uma reconexão: o que veio depois de uma mensagem.
    let first = before["messages"][0]["id"].as_str().unwrap();
    let (_, after) = call(
        &ctx.router,
        "GET",
        &format!("{uri}?after={first}&limit=2"),
        token,
        None,
    )
    .await;
    assert_eq!(bodies(&after), ["mensagem 2", "mensagem 3"]);
    assert_eq!(after["has_more"], true);
}

#[tokio::test]
async fn pedido_de_pagina_invalido() {
    let ctx = setup().await;
    let token = Some(ctx.owner_token.as_str());
    for uri in [
        "/api/channels/geral/messages?limit=0",
        "/api/channels/geral/messages?limit=101",
        "/api/channels/geral/messages?before=a&after=b",
        "/api/channels/geral/messages?limit=muitas",
    ] {
        let (status, body) = call(&ctx.router, "GET", uri, token, None).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{uri}: {body}");
    }
}

#[tokio::test]
async fn texto_invalido_e_recusado() {
    let ctx = setup().await;
    let long = "a".repeat(2001);
    for body in ["", "   ", long.as_str()] {
        let (status, error) = send(&ctx, &ctx.owner_token, "c-1", body).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(error["kind"], "invalid_request");
    }
}

#[tokio::test]
async fn canal_que_nao_e_de_texto_nao_existe() {
    let ctx = setup().await;
    for channel in ["sala", "nao-existe"] {
        let (status, _) = call(
            &ctx.router,
            "GET",
            &format!("/api/channels/{channel}/messages"),
            Some(&ctx.owner_token),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{channel}");
    }
}

#[tokio::test]
async fn sem_sessao_nao_le_nem_escreve() {
    let ctx = setup().await;
    let (status, _) = call(
        &ctx.router,
        "GET",
        "/api/channels/geral/messages",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = call(&ctx.router, "GET", "/api/people", None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn mensagens_demais_seguidas_dao_429() {
    let ctx = setup().await;
    for i in 0..5 {
        let (status, _) = send(&ctx, &ctx.owner_token, &format!("c-{i}"), "oi").await;
        assert_eq!(status, StatusCode::CREATED);
    }
    let (status, error) = send(&ctx, &ctx.owner_token, "c-5", "oi").await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(error["kind"], "too_many_messages");

    // O "Tentar de novo" de uma mensagem já gravada não conta no limite.
    let (status, _) = send(&ctx, &ctx.owner_token, "c-4", "oi").await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn texto_invalido_nao_conta_no_limite() {
    let ctx = setup().await;
    for i in 0..5 {
        let (status, _) = send(&ctx, &ctx.owner_token, &format!("x-{i}"), "   ").await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    }
    let (status, _) = send(&ctx, &ctx.owner_token, "c-1", "oi").await;
    assert_eq!(status, StatusCode::CREATED);
}

#[tokio::test]
async fn client_id_de_outro_canal_da_conflito() {
    let ctx = setup().await;
    let (status, _) = send(&ctx, &ctx.owner_token, "c-1", "oi").await;
    assert_eq!(status, StatusCode::CREATED);
    sqlx::query(
        "INSERT INTO channels (id, kind, name, position, created_at)
         VALUES ('outro', 'text', 'outro', 9, 0)",
    )
    .execute(&ctx.db)
    .await
    .unwrap();
    let (status, error) = call(
        &ctx.router,
        "POST",
        "/api/channels/outro/messages",
        Some(&ctx.owner_token),
        Some(json!({ "client_id": "c-1", "body": "oi" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");
}

#[tokio::test]
async fn quem_saiu_deixa_as_mensagens_e_some_da_lista() {
    let ctx = setup().await;
    let token = join(&ctx, "Fulano", 2, false).await;
    send(&ctx, &token, "c-1", "tchau").await;

    let fulano = users::get_active_by_nick(&ctx.db, "Fulano").await.unwrap();
    users::remove(&ctx.db, &ctx.owner, &fulano, now())
        .await
        .unwrap();

    let (_, page) = call(
        &ctx.router,
        "GET",
        "/api/channels/geral/messages",
        Some(&ctx.owner_token),
        None,
    )
    .await;
    assert_eq!(page["messages"][0]["author"]["nick"], "Fulano");
    assert_eq!(page["messages"][0]["author"]["removed"], true);

    let (status, people) = call(
        &ctx.router,
        "GET",
        "/api/people",
        Some(&ctx.owner_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let nicks: Vec<&str> = people
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["nick"].as_str().unwrap())
        .collect();
    assert_eq!(nicks, ["Kid"]);
}

// ------------------------------------------------------------ chat avançado (ADR 0032)

async fn get_page(ctx: &Ctx, query: &str) -> Value {
    let (status, page) = call(
        &ctx.router,
        "GET",
        &format!("/api/channels/geral/messages{query}"),
        Some(&ctx.owner_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{page}");
    page
}

fn message_uri(message: &Value) -> String {
    format!("/api/messages/{}", message["id"].as_str().unwrap())
}

#[tokio::test]
async fn so_o_autor_edita_e_a_mencao_nova_vem_no_evento() {
    let ctx = setup().await;
    let bia = join(&ctx, "Bia", 2, false).await;
    let _cadu = join(&ctx, "Cadu", 3, false).await;
    let cadu_id = users::get_active_by_nick(&ctx.db, "Cadu").await.unwrap().id;
    let bia_id = users::get_active_by_nick(&ctx.db, "Bia").await.unwrap().id;
    let (_, message) = send(&ctx, &bia, "c-1", "oi @Kid").await;
    assert_eq!(message["edited_at"], Value::Null);

    // Nem o dono edita a mensagem dos outros.
    let (status, _) = call(
        &ctx.router,
        "PATCH",
        &message_uri(&message),
        Some(&ctx.owner_token),
        Some(json!({ "body": "mudei" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let edited = api::chat::messages::edit(
        &ctx.db,
        &Readable::Text(
            api::chat::channels::get_open_text(&ctx.db, "geral")
                .await
                .unwrap(),
        ),
        &users::get_by_id(&ctx.db, &bia_id).await.unwrap(),
        &api::chat::messages::find(&ctx.db, message["id"].as_str().unwrap())
            .await
            .unwrap()
            .unwrap(),
        "oi @Kid e @Cadu",
        now(),
    )
    .await
    .unwrap();
    // O Kid já tinha sido mencionado: só o Cadu é novo.
    assert_eq!(edited.new_mentions, std::slice::from_ref(&cadu_id));
    assert!(edited.message.mentions.contains(&cadu_id));
    assert!(edited.message.edited_at.is_some());

    let (status, again) = call(
        &ctx.router,
        "PATCH",
        &message_uri(&message),
        Some(&bia),
        Some(json!({ "body": "  só @Cadu  " })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["body"], "só @Cadu");
    assert_eq!(again["mentions"], json!([cadu_id]));
    assert_eq!(bodies(&get_page(&ctx, "").await), ["só @Cadu"]);

    // Texto inválido continua recusado.
    let (status, _) = call(
        &ctx.router,
        "PATCH",
        &message_uri(&message),
        Some(&bia),
        Some(json!({ "body": "   " })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn excluir_e_a_resposta_fica_sem_a_original() {
    let ctx = setup().await;
    let bia = join(&ctx, "Bia", 2, false).await;
    let cadu = join(&ctx, "Cadu", 3, false).await;
    let (_, original) = send(&ctx, &bia, "c-1", "quem joga hoje?").await;
    let (status, reply) = call(
        &ctx.router,
        "POST",
        "/api/channels/geral/messages",
        Some(&cadu),
        Some(json!({ "client_id": "c-2", "body": "eu", "reply_to": original["id"] })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{reply}");
    assert_eq!(reply["reply_to"]["id"], original["id"]);
    assert_eq!(reply["reply_to"]["author"]["nick"], "Bia");
    assert_eq!(reply["reply_to"]["excerpt"], "quem joga hoje?");
    // Com o `@` ligado (o padrão), a resposta menciona quem escreveu a original.
    let bia_id = users::get_active_by_nick(&ctx.db, "Bia").await.unwrap().id;
    assert_eq!(reply["mentions"], json!([bia_id]));
    let (_, quiet) = call(
        &ctx.router,
        "POST",
        "/api/channels/geral/messages",
        Some(&ctx.owner_token),
        Some(json!({
            "client_id": "c-9",
            "body": "eu também",
            "reply_to": original["id"],
            "reply_mention": false,
        })),
    )
    .await;
    assert_eq!(quiet["mentions"], json!([]));

    // Responder a uma mensagem que não existe é recusado.
    let (status, _) = call(
        &ctx.router,
        "POST",
        "/api/channels/geral/messages",
        Some(&cadu),
        Some(json!({ "client_id": "c-3", "body": "eu", "reply_to": "nada" })),
    )
    .await;
    assert!(status.is_client_error(), "{status}");

    // O Cadu não exclui a da Bia; o dono exclui, num canal.
    let (status, _) = call(
        &ctx.router,
        "DELETE",
        &message_uri(&original),
        Some(&cadu),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = call(
        &ctx.router,
        "DELETE",
        &message_uri(&original),
        Some(&ctx.owner_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = call(
        &ctx.router,
        "DELETE",
        &message_uri(&original),
        Some(&bia),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let page = get_page(&ctx, "").await;
    assert_eq!(bodies(&page), ["eu", "eu também"]);
    let quoted = &page["messages"][0]["reply_to"];
    assert_eq!(quoted["id"], original["id"]);
    assert_eq!(quoted["author"], Value::Null);
    assert_eq!(quoted["excerpt"], Value::Null);

    // O autor exclui a própria.
    let (status, _) = call(
        &ctx.router,
        "DELETE",
        &message_uri(&reply),
        Some(&cadu),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(bodies(&get_page(&ctx, "").await), ["eu também"]);
}

#[tokio::test]
async fn o_dono_nao_exclui_nem_ve_a_conversa_dos_outros() {
    let ctx = setup().await;
    let bia = join(&ctx, "Bia", 2, false).await;
    let _cadu = join(&ctx, "Cadu", 3, false).await;
    let cadu_id = users::get_active_by_nick(&ctx.db, "Cadu").await.unwrap().id;
    let (status, dm) = call(
        &ctx.router,
        "POST",
        "/api/dms",
        Some(&bia),
        Some(json!({ "user_id": cadu_id })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{dm}");
    let (status, message) = call(
        &ctx.router,
        "POST",
        &format!("/api/channels/{}/messages", dm["id"].as_str().unwrap()),
        Some(&bia),
        Some(json!({ "client_id": "c-1", "body": "segredo" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{message}");

    for (method, uri) in [
        ("DELETE", message_uri(&message)),
        (
            "PUT",
            format!("{}/reactions/%F0%9F%91%8D", message_uri(&message)),
        ),
    ] {
        let (status, _) = call(&ctx.router, method, &uri, Some(&ctx.owner_token), None).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{method} {uri}");
    }
}

#[tokio::test]
async fn reacoes() {
    let ctx = setup().await;
    let bia = join(&ctx, "Bia", 2, false).await;
    let (_, message) = send(&ctx, &bia, "c-1", "gg").await;
    let thumbs = format!("{}/reactions/%F0%9F%91%8D", message_uri(&message));

    for token in [&bia, &ctx.owner_token, &ctx.owner_token] {
        let (status, body) = call(&ctx.router, "PUT", &thumbs, Some(token), None).await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }
    let page = get_page(&ctx, "").await;
    let reactions = &page["messages"][0]["reactions"];
    assert_eq!(reactions.as_array().unwrap().len(), 1);
    assert_eq!(reactions[0]["emoji"], "👍");
    assert_eq!(reactions[0]["users"].as_array().unwrap().len(), 2);

    let (status, body) = call(&ctx.router, "DELETE", &thumbs, Some(&bia), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["reactions"][0]["users"], json!([ctx.owner.id]));

    // Emoji do grupo e emoji inválido.
    let custom = format!("{}/reactions/c:abc-123", message_uri(&message));
    let (status, _) = call(&ctx.router, "PUT", &custom, Some(&bia), None).await;
    assert_eq!(status, StatusCode::OK);
    let invalid = format!("{}/reactions/oi", message_uri(&message));
    let (status, _) = call(&ctx.router, "PUT", &invalid, Some(&bia), None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn no_maximo_20_reacoes_diferentes() {
    let ctx = setup().await;
    let (_, message) = send(&ctx, &ctx.owner_token, "c-1", "vota aí").await;
    let emojis: Vec<char> = ('\u{1F600}'..='\u{1F615}').collect();
    assert_eq!(emojis.len(), 22);
    for (i, emoji) in emojis.iter().enumerate() {
        let mut buf = [0; 4];
        let encoded: String = emoji
            .encode_utf8(&mut buf)
            .bytes()
            .map(|b| format!("%{b:02X}"))
            .collect();
        let uri = format!("{}/reactions/{encoded}", message_uri(&message));
        let (status, _) = call(&ctx.router, "PUT", &uri, Some(&ctx.owner_token), None).await;
        if i < 20 {
            assert_eq!(status, StatusCode::OK);
        } else {
            assert_eq!(status, StatusCode::CONFLICT);
        }
    }
}

#[tokio::test]
async fn pagina_em_volta_de_uma_mensagem() {
    let ctx = setup().await;
    seed(&ctx, 30).await;
    let all = get_page(&ctx, "?limit=30").await;
    let ten = all["messages"][10]["id"].as_str().unwrap().to_owned();

    let page = get_page(&ctx, &format!("?around={ten}&limit=6")).await;
    assert_eq!(
        bodies(&page),
        [
            "mensagem 7",
            "mensagem 8",
            "mensagem 9",
            "mensagem 10",
            "mensagem 11",
            "mensagem 12"
        ]
    );
    assert_eq!(page["has_more"], true);
    assert_eq!(page["has_newer"], true);

    let last = all["messages"][29]["id"].as_str().unwrap().to_owned();
    let page = get_page(&ctx, &format!("?around={last}&limit=6")).await;
    assert_eq!(bodies(&page).last().unwrap(), "mensagem 29");
    assert_eq!(page["has_newer"], false);

    let (status, _) = call(
        &ctx.router,
        "GET",
        &format!("/api/channels/geral/messages?around={last}&before={last}"),
        Some(&ctx.owner_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}
