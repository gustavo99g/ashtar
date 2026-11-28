//! Testes de integração dos aparelhos de transmissão (ADR 0038): parear pelo código, a sessão
//! separada do aparelho, renomear, desvincular e para onde a tela vai. O LiveKit não está
//! configurado aqui: onde o dono está vem da lista que o hub guarda, publicada pelo próprio teste.

use std::sync::Arc;
use std::time::Duration;

use api::client_policy::ClientPolicy;
use api::db::{self, now};
use api::identity::invites::{self, InviteKind};
use api::identity::{User, users};
use api::realtime::{Audience, Hub};
use api::voice::ParticipantView;
use api::{AppState, app};
use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use semver::Version;
use serde_json::{Value, json};
use sqlx::SqlitePool;
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

async fn pair_code(ctx: &Ctx, token: &str) -> String {
    let (status, body) = call(
        &ctx.router,
        "POST",
        "/api/stream-devices/pair-code",
        Some(token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    // 6 números, por 3 minutos.
    let code = body["code"].as_str().unwrap().to_owned();
    assert!(
        code.len() == 6 && code.bytes().all(|b| b.is_ascii_digit()),
        "{code}"
    );
    let ttl = body["expires_at"].as_i64().unwrap() - now();
    assert!((179..=180).contains(&ttl), "{ttl}");
    code
}

async fn pair(ctx: &Ctx, code: &str) -> (StatusCode, Value) {
    call(
        &ctx.router,
        "POST",
        "/api/stream-devices/pair",
        None,
        Some(json!({ "code": code, "name": "Odin 3" })),
    )
    .await
}

#[tokio::test]
async fn parear_da_ao_aparelho_uma_sessao_que_nao_entra_no_app() {
    let ctx = setup().await;
    let code = pair_code(&ctx, &ctx.owner_token).await;
    let (status, paired) = pair(&ctx, &code).await;
    assert_eq!(status, StatusCode::OK, "{paired}");
    assert_eq!(paired["owner"]["id"], ctx.owner.id);
    assert_eq!(paired["device"]["name"], "Odin 3");
    let device_token = paired["token"].as_str().unwrap();

    // O código vale uma vez só.
    let (status, _) = pair(&ctx, &code).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // A sessão do aparelho não passa nas rotas do app, nem a do app nas do aparelho.
    let (status, _) = call(&ctx.router, "GET", "/api/me", Some(device_token), None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = call(
        &ctx.router,
        "GET",
        "/api/stream-devices/self",
        Some(&ctx.owner_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Sem o dono em nenhuma sala, não há para onde ir.
    let (status, me) = call(
        &ctx.router,
        "GET",
        "/api/stream-devices/self",
        Some(device_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{me}");
    assert_eq!(me["device"]["name"], "Odin 3");
    assert_eq!(me["target"], Value::Null);
    let (status, body) = call(
        &ctx.router,
        "POST",
        "/api/stream-devices/self/screen-token",
        Some(device_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
}

#[tokio::test]
async fn o_aparelho_fica_fora_da_versao_minima_do_app() {
    let db = db::connect_in_memory().await.unwrap();
    let state = AppState::new(db, "https://ashtar.test/");
    let policy = ClientPolicy {
        min_version: Some(Version::new(9, 0, 0)),
    };
    let router = app(state, Arc::new(policy));
    let (status, body) = call(
        &router,
        "POST",
        "/api/stream-devices/pair",
        None,
        Some(json!({ "code": "000000" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    // O "aqui é um Ashtar" do modo Local também: sem sessão e sem versão.
    let (status, body) = call(&router, "GET", "/api/stream-devices/hello", None, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "app": "ashtar" }));
    let (status, _) = call(&router, "GET", "/api/stream-devices", None, None).await;
    assert_eq!(status, StatusCode::UPGRADE_REQUIRED);
}

#[tokio::test]
async fn a_tela_vai_para_a_sala_em_que_o_dono_esta() {
    let ctx = setup().await;
    let code = pair_code(&ctx, &ctx.owner_token).await;
    let (_, paired) = pair(&ctx, &code).await;
    let device_token = paired["token"].as_str().unwrap();
    let person = ParticipantView {
        user_id: ctx.owner.id.clone(),
        nick: "Kid".into(),
        ..ParticipantView::default()
    };
    ctx.hub
        .publish_voice_participants("sala".into(), vec![person], Audience::Everyone);
    let (status, me) = call(
        &ctx.router,
        "GET",
        "/api/stream-devices/self",
        Some(device_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{me}");
    assert_eq!(me["target"]["channel_id"], "sala");
    assert_eq!(me["target"]["kind"], "voice");
}

#[tokio::test]
async fn so_quem_tem_a_permissao_pareia() {
    let ctx = setup().await;
    let ana = join(&ctx, "ana", 2, false).await;
    let (status, _) = call(
        &ctx.router,
        "POST",
        "/api/stream-devices/pair-code",
        Some(&ana),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let ana_id = {
        let (_, me) = call(&ctx.router, "GET", "/api/me", Some(&ana), None).await;
        assert_eq!(me["can_stream_from_device"], false);
        me["user"]["id"].as_str().unwrap().to_owned()
    };
    let (status, _) = call(
        &ctx.router,
        "PUT",
        &format!("/api/members/{ana_id}/permissions/transmissao.aparelho"),
        Some(&ctx.owner_token),
        Some(json!({ "enabled": true })),
    )
    .await;
    assert!(status.is_success(), "{status}");
    let code = pair_code(&ctx, &ana).await;
    let (status, paired) = pair(&ctx, &code).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(paired["owner"]["id"], ana_id.as_str());
}

#[tokio::test]
async fn renomear_e_desvincular_so_o_proprio_aparelho() {
    let ctx = setup().await;
    let code = pair_code(&ctx, &ctx.owner_token).await;
    let (_, paired) = pair(&ctx, &code).await;
    let device_token = paired["token"].as_str().unwrap();
    let id = paired["device"]["id"].as_str().unwrap();

    let (status, renamed) = call(
        &ctx.router,
        "PATCH",
        &format!("/api/stream-devices/{id}"),
        Some(&ctx.owner_token),
        Some(json!({ "name": "  Portátil " })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{renamed}");
    assert_eq!(renamed["name"], "Portátil");

    // O aparelho de outra pessoa é um 404.
    let ana = join(&ctx, "ana", 2, false).await;
    let (status, _) = call(
        &ctx.router,
        "DELETE",
        &format!("/api/stream-devices/{id}"),
        Some(&ana),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (_, list) = call(
        &ctx.router,
        "GET",
        "/api/stream-devices",
        Some(&ctx.owner_token),
        None,
    )
    .await;
    assert_eq!(list.as_array().unwrap().len(), 1);

    let (status, _) = call(
        &ctx.router,
        "DELETE",
        &format!("/api/stream-devices/{id}"),
        Some(&ctx.owner_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = call(
        &ctx.router,
        "GET",
        "/api/stream-devices/self",
        Some(device_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn no_maximo_tres_aparelhos() {
    let ctx = setup().await;
    for _ in 0..3 {
        let code = pair_code(&ctx, &ctx.owner_token).await;
        assert_eq!(pair(&ctx, &code).await.0, StatusCode::OK);
    }
    let (status, _) = call(
        &ctx.router,
        "POST",
        "/api/stream-devices/pair-code",
        Some(&ctx.owner_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}
