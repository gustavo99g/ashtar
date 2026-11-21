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

    // A foto de perfil de agora, todo mundo vê; antes de virar a foto, só quem enviou.
    let (_, avatar) = upload(
        &ctx,
        &bia,
        "kind=avatar&name=eu.webp",
        "image/png",
        PNG.to_vec(),
    )
    .await;
    assert_eq!(
        status_of(cadu.clone(), avatar.clone()).await,
        StatusCode::NOT_FOUND
    );
    json_call(
        &ctx,
        "PUT",
        "/api/me/avatar",
        &bia,
        json!({ "file_id": avatar["id"] }),
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
async fn a_foto_de_perfil_troca_guarda_a_antiga_e_aparece_para_todos() {
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

    // A nova troca, e a antiga fica guardada, só para Bia.
    let (_, second) = upload(
        &ctx,
        &bia,
        "kind=avatar&name=eu2.webp",
        "image/webp",
        webp.clone(),
    )
    .await;
    let second_id = second["id"].as_str().unwrap().to_owned();
    // O relógio do `used_at` é em segundos: a segunda troca tem que ser depois.
    sqlx::query("UPDATE files SET used_at = used_at - 10 WHERE id = ?")
        .bind(&first_id)
        .execute(&ctx.db)
        .await
        .unwrap();
    json_call(
        &ctx,
        "PUT",
        "/api/me/avatar",
        &bia,
        json!({ "file_id": second_id }),
    )
    .await;
    assert_eq!(files_on_disk(&ctx), 2);
    let saved = json_call(&ctx, "GET", "/api/me/avatars", &bia, Value::Null).await;
    let ids: Vec<&str> = saved
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["file_id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, [second_id.as_str(), first_id.as_str()]);
    let file = |token: String, id: String| {
        let ctx = &ctx;
        async move {
            send(
                ctx,
                "GET",
                &format!("/api/files/{id}"),
                Some(&token),
                None,
                Body::empty(),
            )
            .await
            .0
        }
    };
    assert_eq!(
        file(ctx.owner_token.clone(), first_id.clone()).await,
        StatusCode::NOT_FOUND
    );
    assert_eq!(file(bia.clone(), first_id.clone()).await, StatusCode::OK);
    assert_eq!(
        file(ctx.owner_token.clone(), second_id.clone()).await,
        StatusCode::OK
    );

    // A de agora não se apaga; a guardada, sim.
    let (status, _, _) = send(
        &ctx,
        "DELETE",
        &format!("/api/me/avatars/{second_id}"),
        Some(&bia),
        None,
        Body::empty(),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _, _) = send(
        &ctx,
        "DELETE",
        &format!("/api/me/avatars/{first_id}"),
        Some(&bia),
        None,
        Body::empty(),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(
        api::files::find(&ctx.db, &first_id)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(files_on_disk(&ctx), 1);

    // Só ficam as últimas 12: a mais velha sai da tabela e do disco.
    let mut last = second_id.clone();
    for n in 0..12 {
        sqlx::query("UPDATE files SET used_at = used_at - 100 WHERE kind = 'avatar'")
            .execute(&ctx.db)
            .await
            .unwrap();
        let (_, next) = upload(
            &ctx,
            &bia,
            &format!("kind=avatar&name=n{n}.webp"),
            "image/webp",
            webp.clone(),
        )
        .await;
        last = next["id"].as_str().unwrap().to_owned();
        json_call(
            &ctx,
            "PUT",
            "/api/me/avatar",
            &bia,
            json!({ "file_id": last }),
        )
        .await;
    }
    let saved = json_call(&ctx, "GET", "/api/me/avatars", &bia, Value::Null).await;
    assert_eq!(saved.as_array().unwrap().len(), 12);
    assert_eq!(saved[0]["file_id"], last.as_str());
    assert!(
        api::files::find(&ctx.db, &second_id)
            .await
            .unwrap()
            .is_none()
    );
    // Voltar a uma guardada a põe na frente.
    let older = saved[5]["file_id"].as_str().unwrap().to_owned();
    sqlx::query("UPDATE files SET used_at = used_at - 100 WHERE kind = 'avatar'")
        .execute(&ctx.db)
        .await
        .unwrap();
    let me = json_call(
        &ctx,
        "PUT",
        "/api/me/avatar",
        &bia,
        json!({ "file_id": older }),
    )
    .await;
    assert_eq!(me["user"]["avatar"], older.as_str());
    let saved = json_call(&ctx, "GET", "/api/me/avatars", &bia, Value::Null).await;
    assert_eq!(saved[0]["file_id"], older.as_str());
    assert_eq!(saved.as_array().unwrap().len(), 12);
    let second_id = older;

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

    // Tirar volta para a letra, e a foto fica guardada.
    let me = json_call(&ctx, "DELETE", "/api/me/avatar", &bia, json!({})).await;
    assert_eq!(me["user"]["avatar"], Value::Null);
    assert!(
        api::files::find(&ctx.db, &second_id)
            .await
            .unwrap()
            .is_some()
    );
}

/// O `POST` de uma mensagem em #geral: o status e o corpo.
async fn post_message(ctx: &Ctx, token: &str, body: Value) -> (StatusCode, Value) {
    let (status, _, bytes) = send(
        ctx,
        "POST",
        "/api/channels/geral/messages",
        Some(token),
        Some("application/json"),
        Body::from(body.to_string()),
    )
    .await;
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn a_mensagem_leva_os_anexos_e_a_exclusao_apaga_os_arquivos() {
    let ctx = setup().await;
    let bia = join(&ctx, "Bia", 2, false).await;
    let (_, thumb) = upload(
        &ctx,
        &bia,
        "kind=attachment&name=mini.png",
        "image/png",
        PNG.to_vec(),
    )
    .await;
    let (_, image) = upload(
        &ctx,
        &bia,
        &format!(
            "kind=attachment&name=foto.png&width=800&height=600&thumbnail={}",
            thumb["id"].as_str().unwrap()
        ),
        "image/png",
        PNG.to_vec(),
    )
    .await;
    let (_, doc) = upload(
        &ctx,
        &bia,
        "kind=attachment&name=notas.txt",
        "text/plain",
        b"oi".to_vec(),
    )
    .await;
    let id = |f: &Value| f["id"].as_str().unwrap().to_owned();

    // A miniatura não vai como anexo, nem um arquivo de outra pessoa.
    let (status, _) = post_message(
        &ctx,
        &bia,
        json!({ "client_id": "c-0", "body": "", "attachments": [id(&thumb)] }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, _) = post_message(
        &ctx,
        &ctx.owner_token,
        json!({ "client_id": "c-0", "body": "", "attachments": [id(&image)] }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    // Sem anexo, o texto vazio continua recusado.
    let (status, _) = post_message(&ctx, &bia, json!({ "client_id": "c-0", "body": " " })).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    // Mais de 10, ou repetido, não.
    let (status, _) = post_message(
        &ctx,
        &bia,
        json!({ "client_id": "c-0", "body": "", "attachments": vec![id(&doc); 11] }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, _) = post_message(
        &ctx,
        &bia,
        json!({ "client_id": "c-0", "body": "", "attachments": [id(&doc), id(&doc)] }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Só com anexo, na ordem escolhida, com as dimensões e a miniatura.
    let (status, message) = post_message(
        &ctx,
        &bia,
        json!({ "client_id": "c-1", "body": "  ", "attachments": [id(&image), id(&doc)] }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(message["body"], "");
    let attachments = message["attachments"].as_array().unwrap();
    assert_eq!(attachments.len(), 2);
    assert_eq!(attachments[0]["name"], "foto.png");
    assert_eq!(attachments[0]["width"], 800);
    assert_eq!(attachments[0]["thumbnail_id"], thumb["id"]);
    assert_eq!(attachments[1]["mime"], "text/plain");

    // O histórico traz os anexos; a limpeza não leva nada usado.
    let page = json_call(
        &ctx,
        "GET",
        "/api/channels/geral/messages",
        &bia,
        Value::Null,
    )
    .await;
    let last = page["messages"].as_array().unwrap().last().unwrap().clone();
    assert_eq!(last["attachments"], message["attachments"]);
    api::files::sweep(&ctx.db, &ctx.state.files, now() + 2 * 24 * 3600)
        .await
        .unwrap();
    assert_eq!(files_on_disk(&ctx), 3);

    // O mesmo arquivo não vai em outra mensagem.
    let (status, _) = post_message(
        &ctx,
        &bia,
        json!({ "client_id": "c-2", "body": "", "attachments": [id(&doc)] }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Editar para texto vazio vale numa mensagem com anexo.
    let edited = json_call(
        &ctx,
        "PATCH",
        &format!("/api/messages/{}", id(&message)),
        &bia,
        json!({ "body": "legenda" }),
    )
    .await;
    assert_eq!(edited["body"], "legenda");
    let edited = json_call(
        &ctx,
        "PATCH",
        &format!("/api/messages/{}", id(&message)),
        &bia,
        json!({ "body": "" }),
    )
    .await;
    assert_eq!(edited["body"], "");

    // Excluir apaga os três: o original, a miniatura e o documento.
    let (status, _, _) = send(
        &ctx,
        "DELETE",
        &format!("/api/messages/{}", id(&message)),
        Some(&bia),
        None,
        Body::empty(),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(files_on_disk(&ctx), 0);
    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM files")
        .fetch_one(&ctx.db)
        .await
        .unwrap();
    assert_eq!(left, 0);
}

#[tokio::test]
async fn o_video_toca_pelo_link_curto_com_range() {
    let ctx = setup().await;
    let bia = join(&ctx, "Bia", 2, false).await;
    let video: Vec<u8> = b"\x00\x00\x00\x18ftypmp42-o-resto-do-video".to_vec();
    let (_, file) = upload(
        &ctx,
        &bia,
        "kind=attachment&name=clipe.mp4",
        "video/mp4",
        video.clone(),
    )
    .await;
    let (_, image) = upload(
        &ctx,
        &bia,
        "kind=attachment&name=a.png",
        "image/png",
        PNG.to_vec(),
    )
    .await;
    let id = file["id"].as_str().unwrap().to_owned();
    let image_id = image["id"].as_str().unwrap().to_owned();
    let (status, _) = post_message(
        &ctx,
        &bia,
        json!({ "client_id": "c-1", "body": "", "attachments": [id, image_id] }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    // O Range também vale no GET com o token.
    let (status, headers, bytes) = send_with_range(
        &ctx,
        &format!("/api/files/{id}"),
        Some(&ctx.owner_token),
        "bytes=4-7",
    )
    .await;
    assert_eq!(status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(bytes, b"ftyp");
    assert_eq!(
        headers["content-range"],
        format!("bytes 4-7/{}", video.len())
    );
    assert_eq!(headers["accept-ranges"], "bytes");
    let (status, _, _) = send_with_range(
        &ctx,
        &format!("/api/files/{id}"),
        Some(&ctx.owner_token),
        "bytes=9999-",
    )
    .await;
    assert_eq!(status, StatusCode::RANGE_NOT_SATISFIABLE);

    // O link: só para vídeo; sem o token, com o Range.
    let (status, _, _) = send(
        &ctx,
        "POST",
        &format!("/api/files/{}/link", image["id"].as_str().unwrap()),
        Some(&ctx.owner_token),
        None,
        Body::empty(),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let link = json_call(
        &ctx,
        "POST",
        &format!("/api/files/{id}/link"),
        &ctx.owner_token,
        Value::Null,
    )
    .await;
    let path = link["path"].as_str().unwrap().to_owned();
    let (status, headers, bytes) = send_with_range(&ctx, &path, None, "bytes=0-3").await;
    assert_eq!(status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(bytes, &video[..4]);
    assert_eq!(headers["content-type"], "video/mp4");

    // O link de outro arquivo, o vencido e o adulterado: 404.
    let other = path.replace(&id, image["id"].as_str().unwrap());
    let (status, _, _) = send(&ctx, "GET", &other, None, None, Body::empty()).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let past = now() - 1;
    let sig = api::files::sign_link(ctx.state.link_key.as_slice(), &id, past);
    let (status, _, _) = send(
        &ctx,
        "GET",
        &format!("/api/files/{id}/stream?exp={past}&sig={sig}"),
        None,
        None,
        Body::empty(),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let tampered = format!("{}0", &path[..path.len() - 1]);
    let tampered = if tampered == path {
        format!("{}1", &path[..path.len() - 1])
    } else {
        tampered
    };
    let (status, _, _) = send(&ctx, "GET", &tampered, None, None, Body::empty()).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

/// Um GET com o cabeçalho `Range`.
async fn send_with_range(
    ctx: &Ctx,
    uri: &str,
    token: Option<&str>,
    range: &str,
) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let mut request = Request::builder()
        .method("GET")
        .uri(uri)
        .header("range", range);
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    let response = ctx
        .router
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes()
        .to_vec();
    (status, headers, bytes)
}

#[tokio::test]
async fn encaminhar_leva_o_texto_e_os_mesmos_arquivos() {
    let ctx = setup().await;
    let bia = join(&ctx, "Bia", 2, false).await;
    let cadu = join(&ctx, "Cadu", 3, false).await;
    let cadu_id = users::get_active_by_nick(&ctx.db, "Cadu").await.unwrap().id;
    let (_, doc) = upload(
        &ctx,
        &bia,
        "kind=attachment&name=notas.txt",
        "text/plain",
        b"oi".to_vec(),
    )
    .await;
    let doc_id = doc["id"].as_str().unwrap().to_owned();
    let dm = json_call(
        &ctx,
        "POST",
        "/api/dms",
        &bia,
        json!({ "user_id": cadu_id }),
    )
    .await;
    let dm_id = dm["id"].as_str().unwrap().to_owned();
    let original = json_call(
        &ctx,
        "POST",
        &format!("/api/channels/{dm_id}/messages"),
        &bia,
        json!({ "client_id": "c-1", "body": "as notas", "attachments": [doc_id] }),
    )
    .await;
    let original_id = original["id"].as_str().unwrap().to_owned();
    json_call(
        &ctx,
        "PUT",
        &format!("/api/messages/{original_id}/reactions/👍"),
        &cadu,
        Value::Null,
    )
    .await;

    // O dono não lê a conversa: não encaminha (404, como se não existisse).
    let (status, _) = post_message(
        &ctx,
        &ctx.owner_token,
        json!({ "client_id": "f-0", "body": "", "forward": original_id }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // O Cadu encaminha para #geral: o texto, o arquivo e o resumo, sem a reação.
    let (status, forwarded) = post_message(
        &ctx,
        &cadu,
        json!({ "client_id": "f-1", "body": "ignorado", "forward": original_id }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(forwarded["body"], "as notas");
    assert_eq!(forwarded["reactions"], json!([]));
    assert_eq!(forwarded["attachments"][0]["id"], doc["id"]);
    assert_eq!(forwarded["forwarded"]["message_id"], original["id"]);
    assert_eq!(forwarded["forwarded"]["author_name"], "Bia");
    assert_eq!(forwarded["forwarded"]["channel_name"], Value::Null);
    // O mesmo client_id não duplica.
    let (status, again) = post_message(
        &ctx,
        &cadu,
        json!({ "client_id": "f-1", "body": "", "forward": original_id }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(again["id"], forwarded["id"]);

    // Agora o dono vê o arquivo, por #geral.
    let uri = format!("/api/files/{}", doc["id"].as_str().unwrap());
    let (status, _, _) = send(
        &ctx,
        "GET",
        &uri,
        Some(&ctx.owner_token),
        None,
        Body::empty(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Excluir a original não apaga o arquivo da encaminhada; excluir as duas apaga.
    let (status, _, _) = send(
        &ctx,
        "DELETE",
        &format!("/api/messages/{original_id}"),
        Some(&bia),
        None,
        Body::empty(),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(files_on_disk(&ctx), 1);
    let (status, _, _) = send(
        &ctx,
        "GET",
        &uri,
        Some(&ctx.owner_token),
        None,
        Body::empty(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _, _) = send(
        &ctx,
        "DELETE",
        &format!("/api/messages/{}", forwarded["id"].as_str().unwrap()),
        Some(&cadu),
        None,
        Body::empty(),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(files_on_disk(&ctx), 0);
}

#[tokio::test]
async fn fixar_no_canal_e_quem_gerencia_e_na_conversa_os_dois() {
    let ctx = setup().await;
    let bia = join(&ctx, "Bia", 2, false).await;
    let cadu_token = join(&ctx, "Cadu", 3, false).await;
    let cadu = users::get_active_by_nick(&ctx.db, "Cadu").await.unwrap().id;
    let (_, message) =
        post_message(&ctx, &bia, json!({ "client_id": "c-1", "body": "fixa" })).await;
    let pin = format!("/api/messages/{}/pin", message["id"].as_str().unwrap());

    let (status, _, _) = send(&ctx, "PUT", &pin, Some(&bia), None, Body::empty()).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let pinned = json_call(&ctx, "PUT", &pin, &ctx.owner_token, Value::Null).await;
    assert!(pinned["pinned_at"].is_i64());
    let list = json_call(&ctx, "GET", "/api/channels/geral/pins", &bia, Value::Null).await;
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["id"], message["id"]);
    let unpinned = json_call(&ctx, "DELETE", &pin, &ctx.owner_token, Value::Null).await;
    assert_eq!(unpinned["pinned_at"], Value::Null);

    // Na conversa privada, os dois fixam.
    let dm = json_call(&ctx, "POST", "/api/dms", &bia, json!({ "user_id": cadu })).await;
    let dm_id = dm["id"].as_str().unwrap();
    let in_dm = json_call(
        &ctx,
        "POST",
        &format!("/api/channels/{dm_id}/messages"),
        &bia,
        json!({ "client_id": "d-1", "body": "nossa" }),
    )
    .await;
    let pinned = json_call(
        &ctx,
        "PUT",
        &format!("/api/messages/{}/pin", in_dm["id"].as_str().unwrap()),
        &cadu_token,
        Value::Null,
    )
    .await;
    assert!(pinned["pinned_at"].is_i64());

    // Com 50 fixadas, a 51ª pede para desafixar uma.
    for i in 0..50 {
        sqlx::query(
            "INSERT INTO messages (id, channel_id, author_id, client_id, body, created_at, pinned_at)
             VALUES (?, 'geral', ?, ?, 'x', 1, 1)",
        )
        .bind(format!("fixada-{i}"))
        .bind(&ctx.owner.id)
        .bind(format!("p-{i}"))
        .execute(&ctx.db)
        .await
        .unwrap();
    }
    let (status, _, body) = send(
        &ctx,
        "PUT",
        &pin,
        Some(&ctx.owner_token),
        None,
        Body::empty(),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "{}",
        String::from_utf8_lossy(&body)
    );
}

#[tokio::test]
async fn a_midia_do_canal_separa_imagens_de_arquivos_e_pagina_por_mensagem() {
    let ctx = setup().await;
    let bia = join(&ctx, "Bia", 2, false).await;
    let (_, thumb) = upload(
        &ctx,
        &bia,
        "kind=attachment&name=mini.png",
        "image/png",
        PNG.to_vec(),
    )
    .await;
    let (_, image) = upload(
        &ctx,
        &bia,
        &format!(
            "kind=attachment&name=foto.png&width=800&height=600&thumbnail={}",
            thumb["id"].as_str().unwrap()
        ),
        "image/png",
        PNG.to_vec(),
    )
    .await;
    let (_, doc) = upload(
        &ctx,
        &bia,
        "kind=attachment&name=notas.txt",
        "text/plain",
        b"oi".to_vec(),
    )
    .await;
    let (status, message) = post_message(
        &ctx,
        &bia,
        json!({ "client_id": "c-1", "body": "olha", "attachments": [image["id"], doc["id"]] }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{message}");

    let media = json_call(&ctx, "GET", "/api/channels/geral/files", &bia, Value::Null).await;
    assert_eq!(media["files"].as_array().unwrap().len(), 1);
    assert_eq!(media["files"][0]["file"]["id"], image["id"]);
    assert_eq!(media["files"][0]["message_id"], message["id"]);
    assert_eq!(media["files"][0]["author"]["nick"], "Bia");
    let others = json_call(
        &ctx,
        "GET",
        "/api/channels/geral/files?filter=files",
        &bia,
        Value::Null,
    )
    .await;
    assert_eq!(others["files"].as_array().unwrap().len(), 1);
    assert_eq!(others["files"][0]["file"]["name"], "notas.txt");
    assert_eq!(others["has_more"], false);

    // Sete mensagens com oito arquivos cada: a página não corta uma mensagem no meio (48, e não
    // 50) e a seguinte traz o resto. Os ids "pagina-*" vêm depois do UUID v7 na ordem do texto.
    let author = users::get_active_by_nick(&ctx.db, "Bia").await.unwrap().id;
    for m in 0..7 {
        let message_id = format!("pagina-{m}");
        sqlx::query(
            "INSERT INTO messages (id, channel_id, author_id, client_id, body, created_at)
             VALUES (?, 'geral', ?, ?, '', 1)",
        )
        .bind(&message_id)
        .bind(&author)
        .bind(&message_id)
        .execute(&ctx.db)
        .await
        .unwrap();
        for p in 0..8 {
            let file_id = format!("arquivo-{m}-{p}");
            sqlx::query(
                "INSERT INTO files (id, uploader_id, kind, name, mime, size, created_at, used_at)
                 VALUES (?, ?, 'attachment', 'a.zip', 'application/zip', 1, 1, 1)",
            )
            .bind(&file_id)
            .bind(&author)
            .execute(&ctx.db)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO message_files (message_id, file_id, position) VALUES (?, ?, ?)",
            )
            .bind(&message_id)
            .bind(&file_id)
            .bind(p)
            .execute(&ctx.db)
            .await
            .unwrap();
        }
    }
    let page = json_call(
        &ctx,
        "GET",
        "/api/channels/geral/files?filter=files&before=z",
        &bia,
        Value::Null,
    )
    .await;
    let files = page["files"].as_array().unwrap();
    assert_eq!(files.len(), 48);
    assert_eq!(page["has_more"], true);
    assert_eq!(files[0]["message_id"], "pagina-6");
    assert_eq!(files[0]["file"]["id"], "arquivo-6-0");
    let last = files[47]["message_id"].as_str().unwrap();
    assert_eq!(last, "pagina-1");
    let next = json_call(
        &ctx,
        "GET",
        &format!("/api/channels/geral/files?filter=files&before={last}"),
        &bia,
        Value::Null,
    )
    .await;
    // Os oito da pagina-0 e o notas.txt.
    assert_eq!(next["files"].as_array().unwrap().len(), 9);
    assert_eq!(next["has_more"], false);

    // Quem não lê a conversa não vê a mídia dela.
    let cadu = join(&ctx, "Cadu", 3, false).await;
    let cadu_id = users::get_active_by_nick(&ctx.db, "Cadu").await.unwrap().id;
    let dm = json_call(
        &ctx,
        "POST",
        "/api/dms",
        &bia,
        json!({ "user_id": cadu_id }),
    )
    .await;
    let uri = format!("/api/channels/{}/files", dm["id"].as_str().unwrap());
    let (status, _, _) = send(&ctx, "GET", &uri, Some(&cadu), None, Body::empty()).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _, _) = send(
        &ctx,
        "GET",
        &uri,
        Some(&ctx.owner_token),
        None,
        Body::empty(),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn os_emojis_do_grupo_nome_limite_tamanho_e_reacao() {
    let ctx = setup().await;
    let bia = join(&ctx, "Bia", 2, false).await;
    let kid = ctx.owner_token.clone();
    let mut rx = ctx.state.hub.subscribe();
    let file = emoji_file(&ctx, &kid, PNG.to_vec(), "image/png").await;

    // Sem a permissão, 403.
    let (status, _, _) = send(
        &ctx,
        "POST",
        "/api/emojis",
        Some(&bia),
        Some("application/json"),
        Body::from(json!({ "name": "kekw", "file_id": file["id"] }).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let emoji = json_call(
        &ctx,
        "POST",
        "/api/emojis",
        &kid,
        json!({ "name": ":kekw:", "file_id": file["id"] }),
    )
    .await;
    assert_eq!(emoji["name"], "kekw");
    assert_eq!(emoji["animated"], false);
    let mut saw_event = false;
    while let Ok(signal) = rx.try_recv() {
        if let api::realtime::Signal::Event { json, .. } = signal {
            saw_event |= json.as_str().contains("\"emojis.changed\"");
        }
    }
    assert!(saw_event);
    // Todo mundo vê a imagem.
    let (status, _, _) = send(
        &ctx,
        "GET",
        &format!("/api/files/{}", file["id"].as_str().unwrap()),
        Some(&bia),
        None,
        Body::empty(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // O nome repetido.
    let other = emoji_file(&ctx, &kid, PNG.to_vec(), "image/png").await;
    let (status, _, _) = send(
        &ctx,
        "POST",
        "/api/emojis",
        Some(&kid),
        Some("application/json"),
        Body::from(json!({ "name": "kekw", "file_id": other["id"] }).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // O GIF acima de 256 KB.
    let mut gif = b"GIF89a".to_vec();
    gif.resize(300 * 1024, 0);
    let big = emoji_file(&ctx, &kid, gif, "image/gif").await;
    let (status, _, _) = send(
        &ctx,
        "POST",
        "/api/emojis",
        Some(&kid),
        Some("application/json"),
        Body::from(json!({ "name": "grande", "file_id": big["id"] }).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // A reação com o emoji, e depois de excluído.
    let (_, message) = post_message(&ctx, &bia, json!({ "client_id": "c-1", "body": "oi" })).await;
    let reaction = format!(
        "/api/messages/{}/reactions/c:{}",
        message["id"].as_str().unwrap(),
        emoji["id"].as_str().unwrap()
    );
    let reacted = json_call(&ctx, "PUT", &reaction, &bia, Value::Null).await;
    assert_eq!(reacted["reactions"].as_array().unwrap().len(), 1);
    let (status, _, _) = send(
        &ctx,
        "DELETE",
        &format!("/api/emojis/{}", emoji["id"].as_str().unwrap()),
        Some(&kid),
        None,
        Body::empty(),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let list = json_call(&ctx, "GET", "/api/emojis", &bia, Value::Null).await;
    assert_eq!(list, json!([]));
    let page = json_call(
        &ctx,
        "GET",
        "/api/channels/geral/messages",
        &bia,
        Value::Null,
    )
    .await;
    let last = page["messages"].as_array().unwrap().last().unwrap().clone();
    assert_eq!(last["reactions"], json!([]));
    let (status, _, _) = send(&ctx, "PUT", &reaction, Some(&bia), None, Body::empty()).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // O limite de 100.
    let owner = ctx.owner.id.clone();
    for i in 0..100 {
        let id = format!("e-{i}");
        sqlx::query(
            "INSERT INTO files (id, uploader_id, kind, name, mime, size, created_at, used_at)
             VALUES (?, ?, 'emoji', 'e.png', 'image/png', 1, 1, 1)",
        )
        .bind(&id)
        .bind(&owner)
        .execute(&ctx.db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO emojis (id, name, file_id, created_by, created_at) VALUES (?, ?, ?, ?, 1)",
        )
        .bind(&id)
        .bind(format!("e_{i}"))
        .bind(&id)
        .bind(&owner)
        .execute(&ctx.db)
        .await
        .unwrap();
    }
    let (status, _, _) = send(
        &ctx,
        "POST",
        "/api/emojis",
        Some(&kid),
        Some("application/json"),
        Body::from(json!({ "name": "mais_um", "file_id": other["id"] }).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Renomear para um nome que existe.
    let (status, _, _) = send(
        &ctx,
        "PATCH",
        "/api/emojis/e-1",
        Some(&kid),
        Some("application/json"),
        Body::from(json!({ "name": "e_2" }).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _, _) = send(
        &ctx,
        "PATCH",
        "/api/emojis/e-1",
        Some(&kid),
        Some("application/json"),
        Body::from(json!({ "name": "novo" }).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

async fn emoji_file(ctx: &Ctx, token: &str, bytes: Vec<u8>, mime: &str) -> Value {
    let (status, file) = upload(ctx, token, "kind=emoji&name=e.png", mime, bytes).await;
    assert_eq!(status, StatusCode::CREATED, "{file}");
    file
}
