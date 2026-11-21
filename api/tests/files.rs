//! Testes de integração dos arquivos (ADR 0031): o envio, a leitura com a permissão, o corte no
//! tamanho e a limpeza dos não usados.

use std::path::PathBuf;
use std::sync::Arc;

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

async fn setup() -> Ctx {
    let db = db::connect_in_memory().await.unwrap();
    let owner = users::create_owner(&db, "Kid", now()).await.unwrap();
    let data_dir = std::env::temp_dir().join(format!("ashtar-files-{}", uuid::Uuid::new_v4()));
    let mut state = AppState::new(db.clone(), "https://ashtar.test/");
    state.data_dir = data_dir.clone().into();
    state.files = Arc::new(FileStore::new(data_dir.join("files")));
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

async fn upload(
    ctx: &Ctx,
    token: &str,
    query: &str,
    mime: &str,
    bytes: Vec<u8>,
) -> (StatusCode, Value) {
    let (status, _, body) = send(
        ctx,
        "POST",
        &format!("/api/files?{query}"),
        Some(token),
        Some(mime),
        Body::from(bytes),
    )
    .await;
    (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
}

/// Quantos arquivos (fora as pastas) há no disco.
fn files_on_disk(ctx: &Ctx) -> usize {
    fn walk(dir: &std::path::Path) -> usize {
        std::fs::read_dir(dir)
            .map(|entries| {
                entries
                    .flatten()
                    .map(|e| {
                        let path = e.path();
                        if path.is_dir() { walk(&path) } else { 1 }
                    })
                    .sum()
            })
            .unwrap_or(0)
    }
    walk(&ctx.data_dir.join("files"))
}

#[tokio::test]
async fn envia_e_le_de_volta_uma_imagem() {
    let ctx = setup().await;
    let (status, file) = upload(
        &ctx,
        &ctx.owner_token,
        "kind=attachment&name=C%3A%5Cprints%5Cplacar.png&width=640&height=360",
        "image/png",
        PNG.to_vec(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{file}");
    assert_eq!(file["name"], "placar.png");
    assert_eq!(file["mime"], "image/png");
    assert_eq!(file["size"], PNG.len());
    assert_eq!(file["width"], 640);

    let (status, headers, bytes) = send(
        &ctx,
        "GET",
        &format!("/api/files/{}", file["id"].as_str().unwrap()),
        Some(&ctx.owner_token),
        None,
        Body::empty(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, PNG);
    assert_eq!(headers["content-type"], "image/png");
    assert!(
        headers["content-disposition"]
            .to_str()
            .unwrap()
            .starts_with("inline;")
    );
    assert_eq!(headers["x-content-type-options"], "nosniff");
}

#[tokio::test]
async fn o_que_nao_bate_com_a_assinatura_vira_arquivo_comum() {
    let ctx = setup().await;
    let (status, file) = upload(
        &ctx,
        &ctx.owner_token,
        "kind=attachment&name=foto.png&width=640&height=360",
        "image/png",
        b"MZ\x90\x00 isto e um exe".to_vec(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(file["mime"], "application/octet-stream");
    assert_eq!(file["width"], Value::Null);
    let (_, headers, _) = send(
        &ctx,
        "GET",
        &format!("/api/files/{}", file["id"].as_str().unwrap()),
        Some(&ctx.owner_token),
        None,
        Body::empty(),
    )
    .await;
    assert_eq!(headers["content-type"], "application/octet-stream");
    assert!(
        headers["content-disposition"]
            .to_str()
            .unwrap()
            .starts_with("attachment;")
    );
}

#[tokio::test]
async fn passou_do_tamanho_corta_sem_deixar_nada_no_disco() {
    let ctx = setup().await;
    // A foto aceita até 2 MB.
    let (status, error) = upload(
        &ctx,
        &ctx.owner_token,
        "kind=avatar&name=foto.webp",
        "image/webp",
        vec![0; 2 * 1024 * 1024 + 1],
    )
    .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(error["kind"], "file_too_large");
    assert_eq!(files_on_disk(&ctx), 0);
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM files")
        .fetch_one(&ctx.db)
        .await
        .unwrap();
    assert_eq!(rows, 0);

    // O anexo de mais de 100 MB nem começa: o Content-Length já diz.
    let (status, _, _) = send(
        &ctx,
        "POST",
        "/api/files?kind=attachment&name=partida.mp4",
        Some(&ctx.owner_token),
        Some("video/mp4"),
        Body::empty(),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "vazio é recusado");
    let request = Request::builder()
        .method("POST")
        .uri("/api/files?kind=attachment&name=partida.mp4")
        .header("authorization", format!("Bearer {}", ctx.owner_token))
        .header("content-type", "video/mp4")
        .header("content-length", (100 * 1024 * 1024 + 1).to_string());
    let response = ctx
        .router
        .clone()
        .oneshot(request.body(Body::from(vec![0u8; 16])).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn pedidos_invalidos() {
    let ctx = setup().await;
    for query in [
        "kind=preview&name=a.png",
        "kind=attachment&name=%20",
        "kind=nada&name=a.png",
        "kind=attachment&name=a.png&width=0",
        "kind=attachment&name=a.png&thumbnail=nao-existe",
    ] {
        let (status, _) = upload(&ctx, &ctx.owner_token, query, "image/png", PNG.to_vec()).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{query}");
    }
    let (status, _, _) = send(
        &ctx,
        "POST",
        "/api/files?kind=attachment&name=a.png",
        None,
        Some("image/png"),
        Body::from(PNG.to_vec()),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn o_anexo_so_le_quem_le_a_conversa() {
    let ctx = setup().await;
    let bia = join(&ctx, "Bia", 2, false).await;
    let cadu = join(&ctx, "Cadu", 3, false).await;
    let cadu_id = users::get_active_by_nick(&ctx.db, "Cadu").await.unwrap().id;
    let (_, file) = upload(
        &ctx,
        &bia,
        "kind=attachment&name=a.png",
        "image/png",
        PNG.to_vec(),
    )
    .await;
    let (_, thumb) = upload(
        &ctx,
        &bia,
        "kind=attachment&name=mini.png",
        "image/png",
        PNG.to_vec(),
    )
    .await;
    let uri = |f: &Value| format!("/api/files/{}", f["id"].as_str().unwrap());
    let status_of = |token: String, f: Value| {
        let uri = uri(&f);
        let ctx = &ctx;
        async move {
            send(ctx, "GET", &uri, Some(&token), None, Body::empty())
                .await
                .0
        }
    };

    // Antes de ir para uma mensagem, só quem enviou.
    assert_eq!(status_of(bia.clone(), file.clone()).await, StatusCode::OK);
    assert_eq!(
        status_of(cadu.clone(), file.clone()).await,
        StatusCode::NOT_FOUND
    );

    // Numa conversa da Bia com o Cadu: os dois leem, o dono não.
    let dm = json_call(
        &ctx,
        "POST",
        "/api/dms",
        &bia,
        json!({ "user_id": cadu_id }),
    )
    .await;
    let message = json_call(
        &ctx,
        "POST",
        &format!("/api/channels/{}/messages", dm["id"].as_str().unwrap()),
        &bia,
        json!({ "client_id": "c-1", "body": "olha" }),
    )
    .await;
    sqlx::query("UPDATE files SET thumbnail_id = ? WHERE id = ?")
        .bind(thumb["id"].as_str())
        .bind(file["id"].as_str())
        .execute(&ctx.db)
        .await
        .unwrap();
    sqlx::query("INSERT INTO message_files (message_id, file_id, position) VALUES (?, ?, 0)")
        .bind(message["id"].as_str())
        .bind(file["id"].as_str())
        .execute(&ctx.db)
        .await
        .unwrap();
    assert_eq!(status_of(cadu.clone(), file.clone()).await, StatusCode::OK);
    assert_eq!(status_of(cadu.clone(), thumb.clone()).await, StatusCode::OK);
    assert_eq!(
        status_of(ctx.owner_token.clone(), file.clone()).await,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        status_of(ctx.owner_token.clone(), thumb.clone()).await,
        StatusCode::NOT_FOUND
    );

    // A foto de perfil, todo mundo vê.
    let (_, avatar) = upload(
        &ctx,
        &bia,
        "kind=avatar&name=eu.webp",
        "image/png",
        PNG.to_vec(),
    )
    .await;
    assert_eq!(status_of(cadu, avatar).await, StatusCode::OK);
}

#[tokio::test]
async fn a_limpeza_apaga_so_o_que_ninguem_usou_em_24_horas() {
    let ctx = setup().await;
    let mut ids = Vec::new();
    for name in ["velho", "usado", "novo"] {
        let (_, file) = upload(
            &ctx,
            &ctx.owner_token,
            &format!("kind=attachment&name={name}.png"),
            "image/png",
            PNG.to_vec(),
        )
        .await;
        ids.push(file["id"].as_str().unwrap().to_owned());
    }
    let day_ago = now() - 25 * 60 * 60;
    sqlx::query("UPDATE files SET created_at = ? WHERE id IN (?, ?)")
        .bind(day_ago)
        .bind(&ids[0])
        .bind(&ids[1])
        .execute(&ctx.db)
        .await
        .unwrap();
    let mut conn = ctx.db.acquire().await.unwrap();
    api::files::mark_used(&mut conn, std::slice::from_ref(&ids[1]), now())
        .await
        .unwrap();
    drop(conn);
    assert_eq!(files_on_disk(&ctx), 3);

    api::maintain_files(&ctx.state).await;

    let left: Vec<String> = sqlx::query_scalar("SELECT id FROM files ORDER BY id")
        .fetch_all(&ctx.db)
        .await
        .unwrap();
    assert_eq!(left, [ids[1].clone(), ids[2].clone()]);
    assert_eq!(files_on_disk(&ctx), 2);
}

#[tokio::test]
async fn a_foto_de_perfil_troca_apaga_a_antiga_e_aparece_para_todos() {
    let ctx = setup().await;
    let bia = join(&ctx, "Bia", 2, false).await;
    let webp = b"RIFF\x00\x00\x00\x00WEBPVP8 resto".to_vec();
    let (_, first) = upload(
        &ctx,
        &bia,
        "kind=avatar&name=eu.webp",
        "image/webp",
        webp.clone(),
    )
    .await;
    let first_id = first["id"].as_str().unwrap().to_owned();

    let me = json_call(
        &ctx,
        "PUT",
        "/api/me/avatar",
        &bia,
        json!({ "file_id": first_id }),
    )
    .await;
    assert_eq!(me["user"]["avatar"], first_id.as_str());

    // Todo mundo vê: na lista de pessoas e nas mensagens.
    json_call(
        &ctx,
        "POST",
        "/api/channels/geral/messages",
        &bia,
        json!({ "client_id": "c-1", "body": "oi" }),
    )
    .await;
    let (_, _, bytes) = send(
        &ctx,
        "GET",
        "/api/people",
        Some(&ctx.owner_token),
        None,
        Body::empty(),
    )
    .await;
    let people: Value = serde_json::from_slice(&bytes).unwrap();
    let shown = people
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["nick"] == "Bia")
        .unwrap();
    assert_eq!(shown["avatar"], first_id.as_str());
    let (_, _, bytes) = send(
        &ctx,
        "GET",
        "/api/channels/geral/messages",
        Some(&ctx.owner_token),
        None,
        Body::empty(),
    )
    .await;
    let page: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(page["messages"][0]["author"]["avatar"], first_id.as_str());

    // A nova troca e a antiga some da tabela e do disco.
    let (_, second) = upload(&ctx, &bia, "kind=avatar&name=eu2.webp", "image/webp", webp).await;
    let second_id = second["id"].as_str().unwrap().to_owned();
    json_call(
        &ctx,
        "PUT",
        "/api/me/avatar",
        &bia,
        json!({ "file_id": second_id }),
    )
    .await;
    assert!(
        api::files::find(&ctx.db, &first_id)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(files_on_disk(&ctx), 1);

    // Um anexo, ou a foto de outra pessoa, não serve.
    let (_, attachment) = upload(
        &ctx,
        &bia,
        "kind=attachment&name=a.png",
        "image/png",
        PNG.to_vec(),
    )
    .await;
    let (_, theirs) = upload(
        &ctx,
        &ctx.owner_token,
        "kind=avatar&name=k.png",
        "image/png",
        PNG.to_vec(),
    )
    .await;
    for file in [attachment, theirs] {
        let (status, _, _) = send(
            &ctx,
            "PUT",
            "/api/me/avatar",
            Some(&bia),
            Some("application/json"),
            Body::from(json!({ "file_id": file["id"] }).to_string()),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    }

    // Tirar volta para a letra, e a foto sai.
    let me = json_call(&ctx, "DELETE", "/api/me/avatar", &bia, json!({})).await;
    assert_eq!(me["user"]["avatar"], Value::Null);
    assert!(
        api::files::find(&ctx.db, &second_id)
            .await
            .unwrap()
            .is_none()
    );
}
