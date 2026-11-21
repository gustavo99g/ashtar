//! Testes de integração do "Enviar logs" e do estado do servidor (v0.6, decisões 16, 17 e 21).

use std::path::PathBuf;
use std::sync::Arc;

use api::client_policy::ClientPolicy;
use api::db::{self, now};
use api::identity::invites::{self, InviteKind};
use api::identity::{User, users};
use api::realtime::{Audience, Hub, Signal};
use api::{AppState, app, logs};
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
    data_dir: PathBuf,
}

impl Drop for Ctx {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.data_dir);
    }
}

async fn setup() -> Ctx {
    let db = db::connect_in_memory().await.unwrap();
    let owner = users::create_owner(&db, "Kid", now()).await.unwrap();
    let data_dir = std::env::temp_dir().join(format!("ashtar-logs-{}", uuid::Uuid::new_v4()));
    let mut state = AppState::new(db.clone(), "https://ashtar.test/");
    state.data_dir = data_dir.clone().into();
    let hub = state.hub.clone();
    let router = app(state, Arc::new(ClientPolicy::default()));
    let mut ctx = Ctx {
        db,
        router,
        hub,
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
    router: &Router,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Body,
    json_body: bool,
) -> (StatusCode, Vec<u8>) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-app-version", "0.6.0");
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    if json_body {
        request = request.header("content-type", "application/json");
    }
    let response = router
        .clone()
        .oneshot(request.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, bytes.to_vec())
}

async fn call(
    router: &Router,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let has_body = body.is_some();
    let body = body.map_or_else(Body::empty, |body| Body::from(body.to_string()));
    let (status, bytes) = send(router, method, uri, token, body, has_body).await;
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
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

fn zip(size: usize) -> Vec<u8> {
    let mut bytes = b"PK\x03\x04".to_vec();
    bytes.resize(size.max(4), b'x');
    bytes
}

async fn upload(ctx: &Ctx, token: &str, note: &str, bytes: Vec<u8>) -> (StatusCode, Value) {
    let uri = format!("/api/logs?note={note}");
    let (status, body) = send(
        &ctx.router,
        "POST",
        &uri,
        Some(token),
        Body::from(bytes),
        false,
    )
    .await;
    (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
}

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
async fn o_membro_manda_e_so_o_dono_ve_e_baixa() {
    let ctx = setup().await;
    let ana = join(&ctx, "ana", 2, false).await;
    let mut rx = ctx.hub.subscribe();

    let (status, report) = upload(&ctx, &ana, "caiu%20a%20voz", zip(100)).await;
    assert_eq!(status, StatusCode::OK, "{report}");
    assert_eq!(report["nick"], "ana");
    assert_eq!(report["note"], "caiu a voz");
    assert_eq!(report["app_version"], "0.6.0");
    assert_eq!(report["size"], 100);

    // O aviso vai só para o dono.
    let events = drain(&mut rx);
    let received: Vec<_> = events
        .iter()
        .filter(|(event, _)| event["type"] == "logs.received")
        .collect();
    assert_eq!(received.len(), 1);
    assert!(
        matches!(&received[0].1, Audience::Only(to) if to.as_ref() == [ctx.owner.id.clone()]),
        "{:?}",
        received[0].1
    );

    // Quem não é dono não acha nada.
    let id = report["id"].as_str().unwrap();
    let (status, _) = call(&ctx.router, "GET", "/api/logs", Some(&ana), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = call(
        &ctx.router,
        "GET",
        &format!("/api/logs/{id}"),
        Some(&ana),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, list) = call(
        &ctx.router,
        "GET",
        "/api/logs",
        Some(&ctx.owner_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list.as_array().unwrap().len(), 1);
    let (status, bytes) = send(
        &ctx.router,
        "GET",
        &format!("/api/logs/{id}"),
        Some(&ctx.owner_token),
        Body::empty(),
        false,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, zip(100));
}

#[tokio::test]
async fn um_envio_a_cada_5_minutos_e_ate_10_mb() {
    let ctx = setup().await;
    let ana = join(&ctx, "ana", 2, false).await;

    let (status, body) = upload(&ctx, &ana, "", zip(logs::MAX_SIZE + 1)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let (status, _) = upload(&ctx, &ana, "", b"nao e zip".to_vec()).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, _) = upload(&ctx, &ana, "", zip(10)).await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = upload(&ctx, &ana, "", zip(10)).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(body["kind"], "too_many_attempts");
    // O limite é por pessoa.
    let (status, _) = upload(&ctx, &ctx.owner_token, "", zip(10)).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn os_de_mais_de_30_dias_saem_com_o_arquivo() {
    let ctx = setup().await;
    let ana = join(&ctx, "ana", 2, false).await;
    let (_, report) = upload(&ctx, &ana, "", zip(10)).await;
    let id = report["id"].as_str().unwrap().to_owned();
    let file = ctx.data_dir.join("logs").join(format!("{id}.zip"));
    assert!(file.exists());

    assert_eq!(logs::prune(&ctx.db, &ctx.data_dir, now()).await.unwrap(), 0);
    let later = now() + logs::KEEP_SECS + 1;
    assert_eq!(logs::prune(&ctx.db, &ctx.data_dir, later).await.unwrap(), 1);
    assert!(!file.exists());
    assert!(logs::list(&ctx.db).await.unwrap().is_empty());
}

#[tokio::test]
async fn o_estado_do_servidor_e_so_do_dono_e_diz_quando_o_livekit_esta_fora() {
    let ctx = setup().await;
    let ana = join(&ctx, "ana", 2, false).await;
    let (status, _) = call(&ctx.router, "GET", "/api/admin/status", Some(&ana), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    std::fs::create_dir_all(ctx.data_dir.join("backups")).unwrap();
    std::fs::write(
        ctx.data_dir.join("backups/ashtar-2026-11-19-223000000.db"),
        b"db",
    )
    .unwrap();
    let (status, body) = call(
        &ctx.router,
        "GET",
        "/api/admin/status",
        Some(&ctx.owner_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["api"]["version"], env!("CARGO_PKG_VERSION"));
    // Sem o LiveKit configurado no teste: fora, com o motivo.
    assert_eq!(body["livekit"]["ok"], false);
    assert!(body["livekit"]["error"].is_string());
    assert_eq!(
        body["last_backup"]["name"],
        "ashtar-2026-11-19-223000000.db"
    );
}

/// Um `.zip` de verdade, com estes arquivos.
fn real_zip(files: &[(&str, &str)]) -> Vec<u8> {
    use std::io::Write;
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, text) in files {
        writer
            .start_file(*name, zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(text.as_bytes()).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

#[tokio::test]
async fn quem_tem_ver_logs_le_os_arquivos_no_app() {
    use api::identity::permissions::{self, Permission};
    let ctx = setup().await;
    let ana = join(&ctx, "ana", 2, false).await;
    let bia = join(&ctx, "bia", 3, false).await;
    let bia_user = users::get_active_by_nick(&ctx.db, "bia").await.unwrap();
    permissions::set(
        &ctx.db,
        &ctx.owner,
        &bia_user,
        Permission::ViewLogs,
        true,
        now(),
    )
    .await
    .unwrap();
    let mut rx = ctx.hub.subscribe();

    let bytes = real_zip(&[
        ("info.txt", "Ashtar 0.7.0"),
        ("logs/app.log", "linha 1\nlinha 2"),
    ]);
    let (status, report) = upload(&ctx, &ana, "x", bytes).await;
    assert_eq!(status, StatusCode::OK, "{report}");
    let id = report["id"].as_str().unwrap();

    // O aviso vai para o dono e para Bia.
    let received: Vec<_> = drain(&mut rx)
        .into_iter()
        .filter(|(event, _)| event["type"] == "logs.received")
        .collect();
    assert!(received[0].1.includes(&ctx.owner.id) && received[0].1.includes(&bia_user.id));

    let uri = format!("/api/logs/{id}/entries");
    let (status, _) = call(&ctx.router, "GET", &uri, Some(&ana), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, list) = call(&ctx.router, "GET", &uri, Some(&bia), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        list,
        json!([
            { "name": "info.txt", "size": 12 },
            { "name": "logs/app.log", "size": 15 },
        ])
    );
    let (status, text) = call(
        &ctx.router,
        "GET",
        &format!("/api/logs/{id}/entry?name=logs%2Fapp.log"),
        Some(&bia),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        text,
        json!({ "name": "logs/app.log", "text": "linha 1\nlinha 2", "truncated": false })
    );
    let (status, _) = call(
        &ctx.router,
        "GET",
        &format!("/api/logs/{id}/entry?name=nada.txt"),
        Some(&bia),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
