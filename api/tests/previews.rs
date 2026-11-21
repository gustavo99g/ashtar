//! Testes de integração da prévia de links (ADR 0032): a busca em segundo plano, o cache, a
//! busca protegida (o redirecionamento para um endereço que não é confiável) e o X do autor.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use api::client_policy::ClientPolicy;
use api::db::{self, now};
use api::files::FileStore;
use api::identity::invites::{self, InviteKind};
use api::identity::{User, users};
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
    state: AppState,
    owner: User,
    owner_token: String,
    data_dir: PathBuf,
}

impl Drop for Ctx {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.data_dir);
    }
}

async fn setup(trusted: Vec<std::net::SocketAddr>) -> Ctx {
    let db = db::connect_in_memory().await.unwrap();
    let owner = users::create_owner(&db, "Kid", now()).await.unwrap();
    let data_dir = std::env::temp_dir().join(format!("ashtar-previews-{}", uuid::Uuid::new_v4()));
    let mut state = AppState::new(db.clone(), "https://ashtar.test/");
    state.data_dir = data_dir.clone().into();
    state.files = Arc::new(FileStore::new(data_dir.join("files")));
    state.previews = Arc::new(api::previews::Guard {
        trusted,
        own: Vec::new(),
    });
    let router = app(state.clone(), Arc::new(ClientPolicy::default()));
    let mut ctx = Ctx {
        db,
        router,
        state,
        owner,
        owner_token: String::new(),
        data_dir,
    };
    ctx.owner_token = join(&ctx, "Kid", 1, true).await;
    ctx
}

fn key(n: u8) -> String {
    format!("{n:02x}").repeat(32)
}

async fn send(
    ctx: &Ctx,
    method: &str,
    uri: &str,
    token: Option<&str>,
    content_type: Option<&str>,
    body: Body,
) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let mut request = Request::builder().method(method).uri(uri);
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    if let Some(content_type) = content_type {
        request = request.header("content-type", content_type);
    }
    let response = ctx
        .router
        .clone()
        .oneshot(request.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, headers, bytes.to_vec())
}

async fn json_call(ctx: &Ctx, method: &str, uri: &str, token: &str, body: Value) -> Value {
    let (status, _, bytes) = send(
        ctx,
        method,
        uri,
        Some(token),
        Some("application/json"),
        Body::from(body.to_string()),
    )
    .await;
    assert!(status.is_success(), "{status}");
    serde_json::from_slice(&bytes).unwrap()
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
    let (status, _, bytes) = send(
        ctx,
        "POST",
        "/api/auth/redeem",
        None,
        Some("application/json"),
        Body::from(json!({ "code": code, "device_key": key(device), "nick": nick }).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    body["token"].as_str().unwrap().to_owned()
}

const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR-resto-da-imagem";

/// Um site de mentira em 127.0.0.1: devolve o endereço e quantas vezes a `/page` foi buscada.
async fn site(other: Option<std::net::SocketAddr>) -> (std::net::SocketAddr, Arc<AtomicUsize>) {
    use axum::response::{IntoResponse, Redirect};
    use axum::routing::get;
    let hits = Arc::new(AtomicUsize::new(0));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let counter = hits.clone();
    let router = Router::new()
        .route(
            "/page",
            get(move || {
                counter.fetch_add(1, Ordering::SeqCst);
                async {
                    (
                        [("content-type", "text/html; charset=utf-8")],
                        r#"<html><head><title>fallback</title>
                        <meta property="og:site_name" content="Site Teste">
                        <meta property="og:title" content="O título &amp; tal">
                        <meta property="og:description" content="A descrição">
                        <meta property="og:image" content="/img.png"></head></html>"#,
                    )
                }
            }),
        )
        .route(
            "/img.png",
            get(|| async { ([("content-type", "image/png")], PNG.to_vec()) }),
        )
        .route(
            "/plain",
            get(|| async { ([("content-type", "text/plain")], "oi") }),
        )
        .route(
            "/to-other",
            get(move || async move {
                match other {
                    Some(other) => {
                        Redirect::temporary(&format!("http://{other}/page")).into_response()
                    }
                    None => StatusCode::NOT_FOUND.into_response(),
                }
            }),
        );
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (addr, hits)
}

/// O GET da mensagem `id` pelo histórico de #geral.
async fn message(ctx: &Ctx, token: &str, id: &str) -> Value {
    let page = json_call(
        ctx,
        "GET",
        &format!("/api/channels/geral/messages?around={id}"),
        token,
        Value::Null,
    )
    .await;
    page["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == id)
        .unwrap()
        .clone()
}

/// Espera as prévias chegarem (a busca é em segundo plano).
async fn wait_previews(ctx: &Ctx, token: &str, id: &str, count: usize) -> Value {
    for _ in 0..100 {
        let found = message(ctx, token, id).await;
        if found["previews"].as_array().unwrap().len() == count {
            return found;
        }
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
    }
    panic!("as prévias não chegaram");
}

#[tokio::test]
async fn a_previa_chega_depois_com_a_imagem_e_o_cache_nao_busca_de_novo() {
    let (inside, inside_hits) = site(None).await;
    let (outside, outside_hits) = site(None).await;
    // O `outside` redireciona para o `inside`, que não é confiável.
    let (trusted, hits) = site(Some(inside)).await;
    let ctx = setup(vec![trusted, outside]).await;
    let bia = join(&ctx, "Bia", 2, false).await;

    let sent = json_call(
        &ctx,
        "POST",
        "/api/channels/geral/messages",
        &ctx.owner_token,
        json!({
            "client_id": "c-1",
            "body": format!(
                "olha http://{trusted}/page, http://{trusted}/to-other, http://{trusted}/plain e <http://{outside}/page>"
            ),
        }),
    )
    .await;
    assert_eq!(sent["previews"], json!([]));
    let id = sent["id"].as_str().unwrap();
    let found = wait_previews(&ctx, &bia, id, 1).await;
    let preview = &found["previews"][0];
    assert_eq!(preview["url"], format!("http://{trusted}/page"));
    assert_eq!(preview["site"], "Site Teste");
    assert_eq!(preview["title"], "O título & tal");
    assert_eq!(preview["description"], "A descrição");
    // A imagem foi guardada pela API, e quem está no grupo vê.
    let image = preview["image_id"].as_str().unwrap();
    let (status, headers, bytes) = send(
        &ctx,
        "GET",
        &format!("/api/files/{image}"),
        Some(&bia),
        None,
        Body::empty(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers["content-type"], "image/png");
    assert_eq!(bytes, PNG);
    // O link entre < > não foi buscado, nem o redirecionamento para quem não é confiável.
    assert_eq!(outside_hits.load(Ordering::SeqCst), 0);
    assert_eq!(inside_hits.load(Ordering::SeqCst), 0);
    assert_eq!(hits.load(Ordering::SeqCst), 1);

    // O mesmo link de novo vem do cache.
    let again = json_call(
        &ctx,
        "POST",
        "/api/channels/geral/messages",
        &bia,
        json!({ "client_id": "c-2", "body": format!("http://{trusted}/page") }),
    )
    .await;
    let again = wait_previews(&ctx, &bia, again["id"].as_str().unwrap(), 1).await;
    assert_eq!(again["previews"][0]["image_id"], preview["image_id"]);
    assert_eq!(hits.load(Ordering::SeqCst), 1);

    // Só o autor tira; tirada, editar não traz de volta.
    let uri = format!("/api/messages/{id}/previews");
    let (status, _, _) = send(&ctx, "DELETE", &uri, Some(&bia), None, Body::empty()).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let hidden = json_call(&ctx, "DELETE", &uri, &ctx.owner_token, Value::Null).await;
    assert_eq!(hidden["previews"], json!([]));
    json_call(
        &ctx,
        "PATCH",
        &format!("/api/messages/{id}"),
        &ctx.owner_token,
        json!({ "body": format!("de novo http://{trusted}/page") }),
    )
    .await;
    let changed = api::previews::refresh(&ctx.db, &ctx.state.files, &ctx.state.previews, id, now())
        .await
        .unwrap();
    assert!(!changed);

    // Excluir a mensagem com prévia funciona (a outra continua com a dela).
    let other = again["id"].as_str().unwrap();
    let (status, _, _) = send(
        &ctx,
        "DELETE",
        &format!("/api/messages/{other}"),
        Some(&bia),
        None,
        Body::empty(),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn sem_confiar_no_site_local_nada_e_buscado() {
    let (addr, hits) = site(None).await;
    let ctx = setup(Vec::new()).await;
    let sent = json_call(
        &ctx,
        "POST",
        "/api/channels/geral/messages",
        &ctx.owner_token,
        json!({ "client_id": "c-1", "body": format!("http://{addr}/page") }),
    )
    .await;
    let id = sent["id"].as_str().unwrap();
    let changed = api::previews::refresh(&ctx.db, &ctx.state.files, &ctx.state.previews, id, now())
        .await
        .unwrap();
    assert!(!changed);
    assert_eq!(hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_previa_sem_imagem_busca_de_novo_depois_de_meia_hora() {
    let (trusted, hits) = site(None).await;
    let ctx = setup(vec![trusted]).await;
    let url = format!("http://{trusted}/page");
    // Uma busca de 31 minutos atrás que achou o título, mas não a imagem.
    sqlx::query(
        "INSERT INTO link_previews (url, site, title, description, image_id, fetched_at, ok)
         VALUES (?, NULL, 'Sem imagem', NULL, NULL, ?, 1)",
    )
    .bind(&url)
    .bind(now() - 31 * 60)
    .execute(&ctx.db)
    .await
    .unwrap();

    let sent = json_call(
        &ctx,
        "POST",
        "/api/channels/geral/messages",
        &ctx.owner_token,
        json!({ "client_id": "c-1", "body": url }),
    )
    .await;
    let found = wait_previews(&ctx, &ctx.owner_token, sent["id"].as_str().unwrap(), 1).await;
    assert_eq!(hits.load(Ordering::SeqCst), 1);
    assert_eq!(found["previews"][0]["title"], "O título & tal");
    assert!(found["previews"][0]["image_id"].is_string());
}
