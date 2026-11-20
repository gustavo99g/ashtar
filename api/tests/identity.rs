//! Testes de integração da identidade: as rotas de verdade, num banco em
//! memória, sem subir servidor (`oneshot` chama o router direto).
//!
//! No fim do arquivo, o módulo `regras` testa as regras de identidade
//! (membros, convites, dispositivo, sessão e permissões) direto sobre o banco.

use std::sync::Arc;

use api::client_policy::ClientPolicy;
use api::db::{self, now};
use api::identity::invites::{self, InviteKind};
use api::identity::permissions::{self, Permission};
use api::identity::{User, devices, users};
use api::{AppState, app};
use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::SqlitePool;
use tower::ServiceExt;

const DAY: i64 = 24 * 60 * 60;

struct Ctx {
    db: SqlitePool,
    router: Router,
    owner: User,
}

async fn setup() -> Ctx {
    let db = db::connect_in_memory().await.unwrap();
    let owner = users::create_owner(&db, "Kid", now()).await.unwrap();
    let router = app(
        AppState::new(db.clone(), "https://ashtar.test/"),
        Arc::new(ClientPolicy::default()),
    );
    Ctx { db, router, owner }
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
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

async fn new_invite(ctx: &Ctx) -> String {
    invites::create(
        &ctx.db,
        &ctx.owner,
        InviteKind::New,
        None,
        7 * DAY,
        1,
        now(),
    )
    .await
    .unwrap()
    .code
}

async fn redeem(ctx: &Ctx, code: &str, device: u8, nick: &str) -> (StatusCode, Value) {
    call(
        &ctx.router,
        "POST",
        "/api/auth/redeem",
        None,
        Some(json!({ "code": code, "device_key": key(device), "nick": nick })),
    )
    .await
}

#[tokio::test]
async fn convite_cria_o_membro_e_a_sessao_vale() {
    let ctx = setup().await;
    let code = new_invite(&ctx).await;

    let (status, body) = redeem(&ctx, &code, 1, "Fulano").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let token = body["token"].as_str().unwrap();

    let (status, me) = call(&ctx.router, "GET", "/api/me", Some(token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(me["user"]["nick"], "Fulano");
    assert_eq!(me["update_channel"], "stable");
    assert_eq!(me["can_create_invite"], false);
}

#[tokio::test]
async fn o_status_e_guardado_e_so_aceita_os_tres() {
    let ctx = setup().await;
    let code = new_invite(&ctx).await;
    let (_, session) = redeem(&ctx, &code, 1, "ana").await;
    let token = session["token"].as_str().unwrap();

    let (_, me) = call(&ctx.router, "GET", "/api/me", Some(token), None).await;
    assert_eq!(me["status"], "available", "o padrão de quem entra");

    for status in ["busy", "invisible", "available"] {
        let (code, me) = call(
            &ctx.router,
            "PUT",
            "/api/me/status",
            Some(token),
            Some(json!({ "status": status })),
        )
        .await;
        assert_eq!(code, StatusCode::OK, "{me}");
        assert_eq!(me["status"], status);
        let (_, me) = call(&ctx.router, "GET", "/api/me", Some(token), None).await;
        assert_eq!(me["status"], status);
    }

    for body in [json!({ "status": "ausente" }), json!({})] {
        let (code, _) = call(
            &ctx.router,
            "PUT",
            "/api/me/status",
            Some(token),
            Some(body),
        )
        .await;
        assert_eq!(code, StatusCode::UNPROCESSABLE_ENTITY);
    }
    let (code, _) = call(
        &ctx.router,
        "PUT",
        "/api/me/status",
        None,
        Some(json!({ "status": "busy" })),
    )
    .await;
    assert_eq!(code, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn convite_vale_uma_vez_so() {
    let ctx = setup().await;
    let code = new_invite(&ctx).await;
    assert_eq!(redeem(&ctx, &code, 1, "Fulano").await.0, StatusCode::OK);
    assert_eq!(
        redeem(&ctx, &code, 2, "Ciclano").await.0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn convite_expirado_ou_revogado_nao_vale() {
    let ctx = setup().await;
    let expired = invites::create(
        &ctx.db,
        &ctx.owner,
        InviteKind::New,
        None,
        60,
        1,
        now() - 120,
    )
    .await
    .unwrap();
    assert_eq!(
        redeem(&ctx, &expired.code, 1, "Fulano").await.0,
        StatusCode::BAD_REQUEST
    );

    let revoked = invites::create(&ctx.db, &ctx.owner, InviteKind::New, None, DAY, 1, now())
        .await
        .unwrap();
    invites::revoke(&ctx.db, &ctx.owner, &revoked.id[..8], now())
        .await
        .unwrap();
    assert_eq!(
        redeem(&ctx, &revoked.code, 1, "Fulano").await.0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn codigo_digitado_de_qualquer_jeito_funciona() {
    let ctx = setup().await;
    let code = new_invite(&ctx).await;
    let typed = code.replace('-', " ").to_lowercase();
    assert_eq!(redeem(&ctx, &typed, 1, "Fulano").await.0, StatusCode::OK);
}

#[tokio::test]
async fn nick_repetido_ou_invalido_nao_gasta_o_convite() {
    let ctx = setup().await;
    let code = new_invite(&ctx).await;

    assert_eq!(redeem(&ctx, &code, 1, "kid").await.0, StatusCode::CONFLICT);
    assert_eq!(
        redeem(&ctx, &code, 1, "x").await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(redeem(&ctx, &code, 1, "Fulano").await.0, StatusCode::OK);
}

#[tokio::test]
async fn um_computador_nao_entra_em_duas_contas() {
    let ctx = setup().await;
    let first = new_invite(&ctx).await;
    let second = new_invite(&ctx).await;
    assert_eq!(redeem(&ctx, &first, 1, "Fulano").await.0, StatusCode::OK);
    assert_eq!(
        redeem(&ctx, &second, 1, "Ciclano").await.0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn login_troca_a_sessao() {
    let ctx = setup().await;
    let code = new_invite(&ctx).await;
    let (_, body) = redeem(&ctx, &code, 1, "Fulano").await;
    let old = body["token"].as_str().unwrap().to_owned();

    let (status, body) = call(
        &ctx.router,
        "POST",
        "/api/auth/login",
        None,
        Some(json!({ "device_key": key(1) })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let new = body["token"].as_str().unwrap();

    assert_eq!(
        call(&ctx.router, "GET", "/api/me", Some(new), None).await.0,
        StatusCode::OK
    );
    assert_eq!(
        call(&ctx.router, "GET", "/api/me", Some(&old), None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn computador_desconhecido_nao_entra() {
    let ctx = setup().await;
    let (status, body) = call(
        &ctx.router,
        "POST",
        "/api/auth/login",
        None,
        Some(json!({ "device_key": key(9) })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["kind"], "unknown_device");
}

#[tokio::test]
async fn sem_sessao_nao_entra() {
    let ctx = setup().await;
    assert_eq!(
        call(&ctx.router, "GET", "/api/me", None, None).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(&ctx.router, "GET", "/api/me", Some("inventado"), None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let (status, _) = call(
        &ctx.router,
        "POST",
        "/api/voice/token",
        None,
        Some(json!({ "channel_id": "geral" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_rota_antiga_de_voz_nao_existe_mais() {
    // O `/api/voice/join` dava token a quem mandasse a identidade no corpo, sem sessão.
    let ctx = setup().await;
    let (status, _) = call(
        &ctx.router,
        "POST",
        "/api/voice/join",
        None,
        Some(json!({ "channel_id": "sala", "user_id": "x", "display_name": "Fulano" })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn recuperacao_troca_o_computador() {
    let ctx = setup().await;
    let code = new_invite(&ctx).await;
    let (_, body) = redeem(&ctx, &code, 1, "Fulano").await;
    let old = body["token"].as_str().unwrap().to_owned();
    let fulano = users::get_active_by_nick(&ctx.db, "Fulano").await.unwrap();

    let recovery = invites::create(
        &ctx.db,
        &ctx.owner,
        InviteKind::Recovery,
        Some(&fulano),
        DAY,
        1,
        now(),
    )
    .await
    .unwrap();
    let (status, body) = redeem(&ctx, &recovery.code, 2, "ignorado").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["user"]["id"], fulano.id.as_str());
    assert_eq!(body["user"]["nick"], "Fulano");

    // O computador antigo e a sessão dele deixam de valer.
    assert_eq!(
        call(&ctx.router, "GET", "/api/me", Some(&old), None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let (status, _) = call(
        &ctx.router,
        "POST",
        "/api/auth/login",
        None,
        Some(json!({ "device_key": key(1) })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn dono_vincula_o_computador_com_recuperacao() {
    let ctx = setup().await;
    let recovery = invites::create(
        &ctx.db,
        &ctx.owner,
        InviteKind::Recovery,
        Some(&ctx.owner),
        DAY,
        1,
        now(),
    )
    .await
    .unwrap();
    let (status, body) = redeem(&ctx, &recovery.code, 1, "").await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let token = body["token"].as_str().unwrap();
    let (_, me) = call(&ctx.router, "GET", "/api/me", Some(token), None).await;
    assert_eq!(me["user"]["is_owner"], true);
    assert_eq!(me["update_channel"], "beta");
    assert_eq!(me["can_create_invite"], true);
}

#[tokio::test]
async fn remover_derruba_a_sessao_e_libera_o_nick() {
    let ctx = setup().await;
    let code = new_invite(&ctx).await;
    let (_, body) = redeem(&ctx, &code, 1, "Fulano").await;
    let token = body["token"].as_str().unwrap().to_owned();
    let fulano = users::get_active_by_nick(&ctx.db, "Fulano").await.unwrap();

    users::remove(&ctx.db, &ctx.owner, &fulano, now())
        .await
        .unwrap();
    assert_eq!(
        call(&ctx.router, "GET", "/api/me", Some(&token), None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );

    // O nick e o computador ficam livres para um convite novo.
    let code = new_invite(&ctx).await;
    assert_eq!(redeem(&ctx, &code, 1, "Fulano").await.0, StatusCode::OK);

    // O histórico continua apontando para quem usou o primeiro convite.
    let history = invites::list(&ctx.db).await.unwrap();
    assert_eq!(history.len(), 2);
    assert!(
        history
            .iter()
            .all(|i| i.uses.len() == 1 && i.uses[0].nick == "Fulano")
    );
}

#[tokio::test]
async fn desvincular_derruba_a_sessao() {
    let ctx = setup().await;
    let code = new_invite(&ctx).await;
    let (_, body) = redeem(&ctx, &code, 1, "Fulano").await;
    let token = body["token"].as_str().unwrap().to_owned();
    let fulano = users::get_active_by_nick(&ctx.db, "Fulano").await.unwrap();

    devices::unlink(&ctx.db, &ctx.owner, &fulano).await.unwrap();
    assert_eq!(
        call(&ctx.router, "GET", "/api/me", Some(&token), None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn beta_liga_e_desliga() {
    let ctx = setup().await;
    let code = new_invite(&ctx).await;
    let (_, body) = redeem(&ctx, &code, 1, "Fulano").await;
    let token = body["token"].as_str().unwrap().to_owned();
    let fulano = users::get_active_by_nick(&ctx.db, "Fulano").await.unwrap();

    permissions::set(
        &ctx.db,
        &ctx.owner,
        &fulano,
        Permission::BetaUpdates,
        true,
        now(),
    )
    .await
    .unwrap();
    // Repetir não é erro.
    permissions::set(
        &ctx.db,
        &ctx.owner,
        &fulano,
        Permission::BetaUpdates,
        true,
        now(),
    )
    .await
    .unwrap();
    let (_, me) = call(&ctx.router, "GET", "/api/me", Some(&token), None).await;
    assert_eq!(me["update_channel"], "beta");
    assert_eq!(me["permissions"], json!(["atualizacoes.beta"]));

    permissions::set(
        &ctx.db,
        &ctx.owner,
        &fulano,
        Permission::BetaUpdates,
        false,
        now(),
    )
    .await
    .unwrap();
    let (_, me) = call(&ctx.router, "GET", "/api/me", Some(&token), None).await;
    assert_eq!(me["update_channel"], "stable");
}

#[tokio::test]
async fn membro_nao_administra() {
    let ctx = setup().await;
    let code = new_invite(&ctx).await;
    redeem(&ctx, &code, 1, "Fulano").await;
    let fulano = users::get_active_by_nick(&ctx.db, "Fulano").await.unwrap();

    assert!(
        invites::create(&ctx.db, &fulano, InviteKind::New, None, DAY, 1, now())
            .await
            .is_err()
    );
    assert!(
        users::remove(&ctx.db, &fulano, &ctx.owner, now())
            .await
            .is_err()
    );
    assert!(
        permissions::set(
            &ctx.db,
            &fulano,
            &fulano,
            Permission::BetaUpdates,
            true,
            now()
        )
        .await
        .is_err()
    );
}

#[tokio::test]
async fn erros_demais_travam_por_um_tempo() {
    let ctx = setup().await;
    for _ in 0..20 {
        assert_eq!(
            redeem(&ctx, "AAAA-AAAA-AAAA", 1, "Fulano").await.0,
            StatusCode::BAD_REQUEST
        );
    }
    // Até um convite válido é recusado enquanto a janela não passa.
    let code = new_invite(&ctx).await;
    assert_eq!(
        redeem(&ctx, &code, 1, "Fulano").await.0,
        StatusCode::TOO_MANY_REQUESTS
    );
}

#[tokio::test]
async fn o_login_fica_fora_do_limite_de_tentativas() {
    let ctx = setup().await;
    let code = new_invite(&ctx).await;
    redeem(&ctx, &code, 1, "Fulano").await;

    // Um computador sem convite chama o login ao abrir o app: não conta como erro.
    for _ in 0..30 {
        let (status, body) = call(
            &ctx.router,
            "POST",
            "/api/auth/login",
            None,
            Some(json!({ "device_key": key(9) })),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body["kind"], "unknown_device");
    }
    // Então os convites seguem funcionando.
    let code = new_invite(&ctx).await;
    assert_eq!(redeem(&ctx, &code, 2, "Ciclano").await.0, StatusCode::OK);

    // E, com o limite de convites estourado, quem já é membro continua entrando.
    for _ in 0..20 {
        redeem(&ctx, "AAAA-AAAA-AAAA", 3, "Beltrano").await;
    }
    let code = new_invite(&ctx).await;
    assert_eq!(
        redeem(&ctx, &code, 3, "Beltrano").await.0,
        StatusCode::TOO_MANY_REQUESTS
    );
    let (status, _) = call(
        &ctx.router,
        "POST",
        "/api/auth/login",
        None,
        Some(json!({ "device_key": key(1) })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn convite_de_grupo_aceita_ate_o_limite_de_usos() {
    let ctx = setup().await;
    let invite = invites::create(&ctx.db, &ctx.owner, InviteKind::New, None, 5 * 60, 2, now())
        .await
        .unwrap();

    assert_eq!(
        redeem(&ctx, &invite.code, 1, "Fulano").await.0,
        StatusCode::OK
    );
    assert_eq!(
        redeem(&ctx, &invite.code, 2, "Ciclano").await.0,
        StatusCode::OK
    );
    assert_eq!(
        redeem(&ctx, &invite.code, 3, "Beltrano").await.0,
        StatusCode::BAD_REQUEST
    );

    let history = invites::list(&ctx.db).await.unwrap();
    let nicks: Vec<&str> = history[0].uses.iter().map(|u| u.nick.as_str()).collect();
    assert_eq!(nicks, ["Fulano", "Ciclano"]);
    assert_eq!(history[0].status(now()), invites::InviteStatus::Exhausted);
}

#[tokio::test]
async fn revogar_convite_de_grupo_no_meio_para_de_aceitar() {
    let ctx = setup().await;
    let invite = invites::create(&ctx.db, &ctx.owner, InviteKind::New, None, 5 * 60, 5, now())
        .await
        .unwrap();
    assert_eq!(
        redeem(&ctx, &invite.code, 1, "Fulano").await.0,
        StatusCode::OK
    );

    invites::revoke(&ctx.db, &ctx.owner, &invite.id[..8], now())
        .await
        .unwrap();
    assert_eq!(
        redeem(&ctx, &invite.code, 2, "Ciclano").await.0,
        StatusCode::BAD_REQUEST
    );
    // Quem já entrou continua membro.
    assert!(
        users::find_active_by_nick(&ctx.db, "Fulano")
            .await
            .unwrap()
            .is_some()
    );
}

#[tokio::test]
async fn usos_fora_do_limite_sao_recusados() {
    let ctx = setup().await;
    for usos in [0, 51] {
        assert!(
            invites::create(&ctx.db, &ctx.owner, InviteKind::New, None, DAY, usos, now())
                .await
                .is_err()
        );
    }
}

/// Como `call`, mas com o corpo e o `Content-Type` como texto, para mandar o que
/// não é um JSON bem formado.
async fn call_raw(
    router: &Router,
    uri: &str,
    token: Option<&str>,
    content_type: Option<&str>,
    body: &str,
) -> (StatusCode, Value) {
    let mut request = Request::builder().method("POST").uri(uri);
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    if let Some(content_type) = content_type {
        request = request.header("content-type", content_type);
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::from(body.to_owned())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// Entra com `nick` e devolve o token da sessão.
async fn session(ctx: &Ctx, nick: &str, device: u8) -> String {
    let code = new_invite(ctx).await;
    let (_, body) = redeem(ctx, &code, device, nick).await;
    body["token"].as_str().unwrap().to_owned()
}

#[tokio::test]
async fn corpo_invalido_responde_no_formato_da_api() {
    let ctx = setup().await;
    let token = session(&ctx, "Fulano", 1).await;
    let json = Some("application/json");

    let cases = [
        // (rota, sessão, content-type, corpo)
        ("/api/auth/login", None, json, "{ isto nao e json"),
        ("/api/auth/login", None, json, "{}"),
        ("/api/auth/login", None, json, r#"{"device_key": 123}"#),
        ("/api/auth/login", None, None, r#"{"device_key": "abc"}"#),
        ("/api/auth/redeem", None, json, r#"{"code": "AAAA"}"#),
        ("/api/voice/token", Some(token.as_str()), json, "{}"),
        ("/api/voice/token", Some(token.as_str()), json, "[1, 2]"),
        ("/api/voice/screen-token", Some(token.as_str()), json, "{}"),
    ];
    for (uri, token, content_type, body) in cases {
        let (status, response) = call_raw(&ctx.router, uri, token, content_type, body).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{uri} {body}");
        assert_eq!(response["kind"], "invalid_request", "{uri} {body}");
        assert!(response["message"].is_string(), "{uri} {body}");
    }
}

#[tokio::test]
async fn o_esquema_bearer_nao_diferencia_maiuscula() {
    let ctx = setup().await;
    let token = session(&ctx, "Fulano", 1).await;

    for scheme in ["Bearer", "bearer", "BEARER"] {
        let request = Request::builder()
            .uri("/api/me")
            .header("authorization", format!("{scheme} {token}"))
            .body(Body::empty())
            .unwrap();
        let status = ctx.router.clone().oneshot(request).await.unwrap().status();
        assert_eq!(status, StatusCode::OK, "{scheme}");
    }

    // Outro esquema, ou token vazio, continua recusado.
    for value in [
        format!("Basic {token}"),
        "Bearer ".to_owned(),
        token.clone(),
    ] {
        let request = Request::builder()
            .uri("/api/me")
            .header("authorization", value.as_str())
            .body(Body::empty())
            .unwrap();
        let status = ctx.router.clone().oneshot(request).await.unwrap().status();
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{value}");
    }
}

#[tokio::test]
async fn canal_de_voz_invalido_e_recusado_antes_de_tudo() {
    let ctx = setup().await;
    let token = session(&ctx, "Fulano", 1).await;

    for channel in ["", " ", "com espaco", "../outra", "sala!", &"a".repeat(65)] {
        let (status, body) = call(
            &ctx.router,
            "POST",
            "/api/voice/token",
            Some(&token),
            Some(json!({ "channel_id": channel })),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{channel:?}");
        assert_eq!(body["kind"], "invalid_request", "{channel:?}");
    }

    // Sem sessão, a resposta é 401, mesmo com um canal inválido.
    let (status, _) = call(
        &ctx.router,
        "POST",
        "/api/voice/token",
        None,
        Some(json!({ "channel_id": "" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn token_da_tela_pede_sessao_e_canal_valido() {
    let ctx = setup().await;
    let token = session(&ctx, "Fulano", 1).await;

    for channel in ["", "com espaco", "../outra", &"a".repeat(65)] {
        let (status, body) = call(
            &ctx.router,
            "POST",
            "/api/voice/screen-token",
            Some(&token),
            Some(json!({ "channel_id": channel })),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{channel:?}");
        assert_eq!(body["kind"], "invalid_request", "{channel:?}");
    }

    let (status, _) = call(
        &ctx.router,
        "POST",
        "/api/voice/screen-token",
        None,
        Some(json!({ "channel_id": "geral" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

/// Regras de identidade direto sobre o banco, sem HTTP (SQLite em memória, ou em
/// arquivo onde a concorrência importa).
mod regras {
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use api::db;
    use api::error::ApiError;
    use api::identity::invites::{self, InviteKind, InviteStatus};
    use api::identity::permissions::{self, Origin, Permission};
    use api::identity::{User, devices, users};
    use sqlx::SqlitePool;

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// Caminho de um banco temporário só deste teste (e a URL para abri-lo).
    fn temp_db() -> (std::path::PathBuf, String) {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("ashtar-test-{}-{nanos}-{n}.db", std::process::id()));
        let url = format!("sqlite:{}", path.display().to_string().replace('\\', "/"));
        (path, url)
    }

    fn remove_db(path: &std::path::Path) {
        for suffix in ["", "-wal", "-shm"] {
            let mut file = path.as_os_str().to_owned();
            file.push(suffix);
            let _ = std::fs::remove_file(file);
        }
    }

    const NOW: i64 = 1_000_000;
    const HOUR: i64 = 3_600;

    /// Chave de dispositivo válida (32 a 128 caracteres) a partir de um número.
    fn key(n: u32) -> String {
        format!("{}{n:04}", "k".repeat(40))
    }

    /// Banco novo com o dono criado.
    async fn setup() -> (SqlitePool, User) {
        let pool = db::connect_in_memory().await.unwrap();
        let owner = users::create_owner(&pool, "Dono", NOW).await.unwrap();
        (pool, owner)
    }

    /// Convite de um uso para `nick`, já usado com a chave `n`.
    async fn join(pool: &SqlitePool, owner: &User, nick: &str, n: u32) -> (User, String) {
        let invite = invites::create(pool, owner, InviteKind::New, None, HOUR, 1, NOW)
            .await
            .unwrap();
        let redeemed = invites::redeem(pool, &invite.code, &key(n), Some(nick), NOW)
            .await
            .unwrap();
        (redeemed.user, redeemed.token)
    }

    async fn new_invite(pool: &SqlitePool, owner: &User, ttl: i64, max_uses: i64) -> String {
        invites::create(pool, owner, InviteKind::New, None, ttl, max_uses, NOW)
            .await
            .unwrap()
            .code
    }

    async fn recovery_invite(pool: &SqlitePool, owner: &User, target: &User) -> String {
        invites::create(
            pool,
            owner,
            InviteKind::Recovery,
            Some(target),
            HOUR,
            1,
            NOW,
        )
        .await
        .unwrap()
        .code
    }

    fn successes<T, U>(a: &Result<T, U>, b: &Result<T, U>) -> usize {
        [a.is_ok(), b.is_ok()].iter().filter(|ok| **ok).count()
    }

    // ---------------------------------------------------------------- membros

    #[tokio::test]
    async fn o_dono_so_existe_uma_vez() {
        let (pool, _) = setup().await;
        let again = users::create_owner(&pool, "Outro", NOW).await;
        assert!(matches!(again, Err(ApiError::Conflict(_))));
    }

    #[tokio::test]
    async fn nick_repetido_com_outra_caixa_e_recusado() {
        let (pool, owner) = setup().await;
        join(&pool, &owner, "Kid", 1).await;

        let code = new_invite(&pool, &owner, HOUR, 1).await;
        let result = invites::redeem(&pool, &code, &key(2), Some("kid"), NOW).await;
        assert!(matches!(result, Err(ApiError::NickTaken)));

        // O nick do dono também conta.
        let result = invites::redeem(&pool, &code, &key(2), Some("DONO"), NOW).await;
        assert!(matches!(result, Err(ApiError::NickTaken)));
    }

    #[tokio::test]
    async fn o_dono_nao_pode_ser_removido() {
        let (pool, owner) = setup().await;
        let result = users::remove(&pool, &owner, &owner, NOW).await;
        assert!(matches!(result, Err(ApiError::Conflict(_))));
    }

    #[tokio::test]
    async fn membro_nao_administra() {
        let (pool, owner) = setup().await;
        let (kid, _) = join(&pool, &owner, "Kid", 1).await;
        let (other, _) = join(&pool, &owner, "Outro", 2).await;

        let invite = invites::create(&pool, &kid, InviteKind::New, None, HOUR, 1, NOW).await;
        assert!(matches!(invite, Err(ApiError::Forbidden)));

        let recovery = invites::create(
            &pool,
            &kid,
            InviteKind::Recovery,
            Some(&other),
            HOUR,
            1,
            NOW,
        )
        .await;
        assert!(matches!(recovery, Err(ApiError::Forbidden)));

        assert!(matches!(
            users::remove(&pool, &kid, &other, NOW).await,
            Err(ApiError::Forbidden)
        ));
        assert!(matches!(
            devices::unlink(&pool, &kid, &other).await,
            Err(ApiError::Forbidden)
        ));
        assert!(matches!(
            invites::revoke(&pool, &kid, "abcd", NOW).await,
            Err(ApiError::Forbidden)
        ));
        assert!(matches!(
            permissions::set(&pool, &kid, &other, Permission::BetaUpdates, true, NOW).await,
            Err(ApiError::Forbidden)
        ));
    }

    // ----------------------------------------------------- remoção de membro

    #[tokio::test]
    async fn membro_removido_fica_sem_sessao_sem_dispositivo_e_sem_nick_preso() {
        let (pool, owner) = setup().await;
        let (kid, token) = join(&pool, &owner, "Kid", 1).await;
        let pending = recovery_invite(&pool, &owner, &kid).await;

        users::remove(&pool, &owner, &kid, NOW + 10).await.unwrap();

        // A sessão e o dispositivo caíram.
        assert!(matches!(
            devices::authenticate(&pool, &token, NOW + 11).await,
            Err(ApiError::Unauthenticated)
        ));
        assert!(matches!(
            devices::login(&pool, &key(1), NOW + 11).await,
            Err(ApiError::UnknownDevice)
        ));
        // A recuperação que ainda não tinha sido usada foi revogada.
        assert!(matches!(
            invites::redeem(&pool, &pending, &key(9), None, NOW + 11).await,
            Err(ApiError::InvalidInvite)
        ));

        // O nick ficou livre e a mesma chave pode ser vinculada de novo.
        let code = new_invite(&pool, &owner, HOUR, 1).await;
        let invites::Redeemed { user: again, .. } =
            invites::redeem(&pool, &code, &key(1), Some("kid"), NOW + 12)
                .await
                .unwrap();
        assert_ne!(again.id, kid.id);

        // O histórico continua apontando para o membro removido.
        let history = invites::list(&pool).await.unwrap();
        assert!(
            history
                .iter()
                .any(|i| i.uses.iter().any(|u| u.nick == "Kid"))
        );
    }

    #[tokio::test]
    async fn remover_duas_vezes_avisa() {
        let (pool, owner) = setup().await;
        let (kid, _) = join(&pool, &owner, "Kid", 1).await;
        users::remove(&pool, &owner, &kid, NOW).await.unwrap();
        assert!(matches!(
            users::remove(&pool, &owner, &kid, NOW).await,
            Err(ApiError::Conflict(_))
        ));
    }

    // ------------------------------------------------------------- convites

    #[tokio::test]
    async fn convite_vencido_e_recusado() {
        let (pool, owner) = setup().await;
        let code = new_invite(&pool, &owner, 300, 1).await;

        // No instante exato do vencimento já não vale; um segundo antes, vale.
        let late = invites::redeem(&pool, &code, &key(1), Some("Kid"), NOW + 300).await;
        assert!(matches!(late, Err(ApiError::InvalidInvite)));
        let ok = invites::redeem(&pool, &code, &key(1), Some("Kid"), NOW + 299).await;
        assert!(ok.is_ok());
    }

    #[tokio::test]
    async fn convite_esgotado_e_recusado() {
        let (pool, owner) = setup().await;
        let code = new_invite(&pool, &owner, HOUR, 2).await;

        invites::redeem(&pool, &code, &key(1), Some("Um"), NOW)
            .await
            .unwrap();
        invites::redeem(&pool, &code, &key(2), Some("Dois"), NOW)
            .await
            .unwrap();
        let third = invites::redeem(&pool, &code, &key(3), Some("Tres"), NOW).await;
        assert!(matches!(third, Err(ApiError::InvalidInvite)));

        let history = invites::list(&pool).await.unwrap();
        assert_eq!(history[0].uses.len(), 2);
        assert_eq!(history[0].status(NOW), InviteStatus::Exhausted);
    }

    #[tokio::test]
    async fn convite_revogado_corta_os_proximos_mas_nao_quem_ja_entrou() {
        let (pool, owner) = setup().await;
        let code = new_invite(&pool, &owner, HOUR, 5).await;
        let invites::Redeemed { user: kid, .. } =
            invites::redeem(&pool, &code, &key(1), Some("Kid"), NOW)
                .await
                .unwrap();

        let id = invites::list(&pool).await.unwrap()[0].id.clone();
        invites::revoke(&pool, &owner, &id[..8], NOW).await.unwrap();

        let next = invites::redeem(&pool, &code, &key(2), Some("Outro"), NOW).await;
        assert!(matches!(next, Err(ApiError::InvalidInvite)));
        // Quem já entrou continua entrando.
        let (again, _) = devices::login(&pool, &key(1), NOW).await.unwrap();
        assert_eq!(again.id, kid.id);

        let record = &invites::list(&pool).await.unwrap()[0];
        assert_eq!(record.status(NOW), InviteStatus::Revoked);
    }

    #[tokio::test]
    async fn revogar_valida_o_que_pode_ser_revogado() {
        let (pool, owner) = setup().await;
        let code = new_invite(&pool, &owner, HOUR, 1).await;
        invites::redeem(&pool, &code, &key(1), Some("Kid"), NOW)
            .await
            .unwrap();
        let id = invites::list(&pool).await.unwrap()[0].id.clone();

        assert!(matches!(
            invites::revoke(&pool, &owner, "ab", NOW).await,
            Err(ApiError::InvalidRequest(_))
        ));
        assert!(matches!(
            invites::revoke(&pool, &owner, "zzzz", NOW).await,
            Err(ApiError::NotFound(_))
        ));
        // Curinga não vale: `%` e `_` são caracteres comuns no prefixo.
        assert!(matches!(
            invites::revoke(&pool, &owner, "____", NOW).await,
            Err(ApiError::NotFound(_))
        ));
        // Já usado por completo.
        assert!(matches!(
            invites::revoke(&pool, &owner, &id, NOW).await,
            Err(ApiError::Conflict(_))
        ));
    }

    #[tokio::test]
    async fn criar_convite_valida_validade_usos_e_alvo() {
        let (pool, owner) = setup().await;
        let (kid, _) = join(&pool, &owner, "Kid", 1).await;

        async fn create(
            pool: &SqlitePool,
            owner: &User,
            kind: InviteKind,
            target: Option<&User>,
            ttl: i64,
            uses: i64,
        ) -> Result<invites::CreatedInvite, ApiError> {
            invites::create(pool, owner, kind, target, ttl, uses, NOW).await
        }

        for ttl in [0, 59, -1, invites::MAX_TTL_SECS + 1, i64::MAX] {
            let result = create(&pool, &owner, InviteKind::New, None, ttl, 1).await;
            assert!(matches!(result, Err(ApiError::InvalidRequest(_))), "{ttl}");
        }
        for uses in [0, -1, 51] {
            let result = create(&pool, &owner, InviteKind::New, None, HOUR, uses).await;
            assert!(matches!(result, Err(ApiError::InvalidRequest(_))), "{uses}");
        }
        assert!(
            create(&pool, &owner, InviteKind::New, None, 60, 1)
                .await
                .is_ok()
        );
        assert!(
            create(
                &pool,
                &owner,
                InviteKind::New,
                None,
                invites::MAX_TTL_SECS,
                50
            )
            .await
            .is_ok()
        );

        // Combinação de tipo e alvo: erro, e não panic.
        let with_target = create(&pool, &owner, InviteKind::New, Some(&kid), HOUR, 1).await;
        assert!(matches!(with_target, Err(ApiError::InvalidRequest(_))));
        let without_target = create(&pool, &owner, InviteKind::Recovery, None, HOUR, 1).await;
        assert!(matches!(without_target, Err(ApiError::InvalidRequest(_))));

        // A recuperação ignora `max_uses`: sempre uma vez só.
        let recovery = create(&pool, &owner, InviteKind::Recovery, Some(&kid), HOUR, 30)
            .await
            .unwrap();
        assert_eq!(recovery.max_uses, 1);
    }

    #[tokio::test]
    async fn usar_convite_com_dado_invalido_nao_gasta_o_convite() {
        let (pool, owner) = setup().await;
        let code = new_invite(&pool, &owner, HOUR, 1).await;

        // Nick inválido, nick ausente, chave inválida e código que não é código.
        assert!(matches!(
            invites::redeem(&pool, &code, &key(1), Some("x"), NOW).await,
            Err(ApiError::InvalidNick(_))
        ));
        assert!(matches!(
            invites::redeem(&pool, &code, &key(1), None, NOW).await,
            Err(ApiError::InvalidNick(_))
        ));
        assert!(matches!(
            invites::redeem(&pool, &code, "curta", Some("Kid"), NOW).await,
            Err(ApiError::InvalidDeviceKey)
        ));
        assert!(matches!(
            invites::redeem(&pool, "isto-nao-e-um-codigo", &key(1), Some("Kid"), NOW).await,
            Err(ApiError::InvalidInvite)
        ));

        let record = &invites::list(&pool).await.unwrap()[0];
        assert!(record.uses.is_empty());
        assert_eq!(record.status(NOW), InviteStatus::Pending);
        // Nenhum membro foi criado pelas tentativas.
        assert_eq!(users::list(&pool).await.unwrap().len(), 1);
        // E o convite continua servindo.
        assert!(
            invites::redeem(&pool, &code, &key(1), Some("Kid"), NOW)
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn o_codigo_vale_digitado_de_outro_jeito() {
        let (pool, owner) = setup().await;
        let code = new_invite(&pool, &owner, HOUR, 1).await;
        let typed = format!(" {} ", code.to_lowercase().replace('-', " "));
        assert!(
            invites::redeem(&pool, &typed, &key(1), Some("Kid"), NOW)
                .await
                .is_ok()
        );
    }

    // --------------------------------------------------------- recuperação

    #[tokio::test]
    async fn recuperacao_e_de_uso_unico_e_troca_o_computador() {
        let (pool, owner) = setup().await;
        let (kid, old_token) = join(&pool, &owner, "Kid", 1).await;
        let code = recovery_invite(&pool, &owner, &kid).await;

        // O nick passado é ignorado: o membro é o do convite.
        let invites::Redeemed {
            user: back,
            token: new_token,
            new_member,
        } = invites::redeem(&pool, &code, &key(2), Some("Outro"), NOW)
            .await
            .unwrap();
        assert!(!new_member, "a recuperação não cria membro");
        assert_eq!(back.id, kid.id);
        assert_eq!(back.nick, "Kid");

        // O computador antigo e a sessão antiga deixaram de valer.
        assert!(matches!(
            devices::login(&pool, &key(1), NOW).await,
            Err(ApiError::UnknownDevice)
        ));
        assert!(matches!(
            devices::authenticate(&pool, &old_token, NOW).await,
            Err(ApiError::Unauthenticated)
        ));
        // O novo vale.
        let current = devices::authenticate(&pool, &new_token, NOW).await.unwrap();
        assert_eq!(current.id, kid.id);

        // Uso único.
        assert!(matches!(
            invites::redeem(&pool, &code, &key(3), None, NOW).await,
            Err(ApiError::InvalidInvite)
        ));
        assert_eq!(users::list(&pool).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn o_dono_vincula_o_primeiro_computador_por_recuperacao() {
        let (pool, owner) = setup().await;
        // O dono nasce sem computador.
        assert!(!devices::has_device(&pool, &owner).await.unwrap());
        assert!(matches!(
            devices::login(&pool, &key(1), NOW).await,
            Err(ApiError::UnknownDevice)
        ));

        let code = recovery_invite(&pool, &owner, &owner).await;
        let invites::Redeemed { user, token, .. } =
            invites::redeem(&pool, &code, &key(1), None, NOW)
                .await
                .unwrap();
        assert!(user.is_owner);
        assert!(devices::has_device(&pool, &owner).await.unwrap());
        let current = devices::authenticate(&pool, &token, NOW).await.unwrap();
        assert!(current.is_owner);
    }

    #[tokio::test]
    async fn recuperacao_de_membro_removido_e_recusada() {
        let (pool, owner) = setup().await;
        let (kid, _) = join(&pool, &owner, "Kid", 1).await;
        users::remove(&pool, &owner, &kid, NOW).await.unwrap();

        let result = invites::create(
            &pool,
            &owner,
            InviteKind::Recovery,
            Some(&kid),
            HOUR,
            1,
            NOW,
        )
        .await;
        assert!(matches!(result, Err(ApiError::Conflict(_))));
    }

    // ------------------------------------------------- dispositivo e sessão

    #[tokio::test]
    async fn segundo_dispositivo_e_recusado_e_nao_gasta_o_convite() {
        let (pool, owner) = setup().await;
        join(&pool, &owner, "Kid", 1).await;

        // A mesma chave num convite novo.
        let code = new_invite(&pool, &owner, HOUR, 1).await;
        let result = invites::redeem(&pool, &code, &key(1), Some("Outro"), NOW).await;
        assert!(matches!(result, Err(ApiError::DeviceAlreadyLinked)));

        // Nada ficou pela metade: o convite serve com outra chave e o nick está livre.
        assert_eq!(users::list(&pool).await.unwrap().len(), 2);
        assert!(
            invites::redeem(&pool, &code, &key(2), Some("Outro"), NOW)
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn cada_login_troca_o_token() {
        let (pool, owner) = setup().await;
        let (kid, first) = join(&pool, &owner, "Kid", 1).await;

        let (_, second) = devices::login(&pool, &key(1), NOW + 5).await.unwrap();
        assert_ne!(first, second);
        assert!(matches!(
            devices::authenticate(&pool, &first, NOW + 6).await,
            Err(ApiError::Unauthenticated)
        ));
        let current = devices::authenticate(&pool, &second, NOW + 6)
            .await
            .unwrap();
        assert_eq!(current.id, kid.id);

        // O "visto por último" acompanha as chamadas.
        let seen: i64 = sqlx::query_scalar("SELECT last_seen_at FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(seen, NOW + 6);
    }

    #[tokio::test]
    async fn token_e_chave_desconhecidos_sao_recusados() {
        let (pool, _) = setup().await;
        assert!(matches!(
            devices::authenticate(&pool, "nao-existe", NOW).await,
            Err(ApiError::Unauthenticated)
        ));
        assert!(matches!(
            devices::login(&pool, &key(7), NOW).await,
            Err(ApiError::UnknownDevice)
        ));
        assert!(matches!(
            devices::login(&pool, "curta", NOW).await,
            Err(ApiError::InvalidDeviceKey)
        ));
    }

    #[tokio::test]
    async fn desvincular_derruba_o_computador_e_a_sessao() {
        let (pool, owner) = setup().await;
        let (kid, token) = join(&pool, &owner, "Kid", 1).await;

        devices::unlink(&pool, &owner, &kid).await.unwrap();
        assert!(matches!(
            devices::authenticate(&pool, &token, NOW).await,
            Err(ApiError::Unauthenticated)
        ));
        assert!(matches!(
            devices::login(&pool, &key(1), NOW).await,
            Err(ApiError::UnknownDevice)
        ));
        // O membro continua existindo; só falta computador.
        let still = users::find_active_by_nick(&pool, "kid").await.unwrap();
        assert!(still.is_some());
        assert!(matches!(
            devices::unlink(&pool, &owner, &kid).await,
            Err(ApiError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn nao_guarda_segredo_em_claro() {
        let (pool, owner) = setup().await;
        let code = new_invite(&pool, &owner, HOUR, 1).await;
        let invites::Redeemed {
            token, new_member, ..
        } = invites::redeem(&pool, &code, &key(1), Some("Kid"), NOW)
            .await
            .unwrap();
        assert!(new_member, "o convite novo cria o membro");

        let stored: Vec<String> = sqlx::query_scalar(
            "SELECT code_hash FROM invites UNION ALL SELECT token_hash FROM sessions
             UNION ALL SELECT key_hash FROM devices",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(stored.len(), 3);
        for secret in [code.replace('-', ""), code, token, key(1)] {
            assert!(stored.iter().all(|s| *s != secret && s.len() == 64));
        }
    }

    // ----------------------------------------------------------- permissões

    #[tokio::test]
    async fn beta_e_do_dono_e_de_quem_o_dono_marcar() {
        let (pool, owner) = setup().await;
        let (kid, _) = join(&pool, &owner, "Kid", 1).await;
        let beta = Permission::BetaUpdates;

        // O dono está sempre no beta, sem linha na tabela.
        assert!(permissions::has(&pool, &owner, beta).await.unwrap());
        assert!(!permissions::has(&pool, &kid, beta).await.unwrap());

        permissions::set(&pool, &owner, &kid, beta, true, NOW)
            .await
            .unwrap();
        // Repetir não é erro e não duplica.
        permissions::set(&pool, &owner, &kid, beta, true, NOW)
            .await
            .unwrap();
        assert!(permissions::has(&pool, &kid, beta).await.unwrap());
        let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM user_permissions")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rows, 1);

        let effective = permissions::effective(&pool, &kid).await.unwrap();
        assert_eq!(effective, [(beta, Origin::Direct)]);
        let owners = permissions::effective(&pool, &owner).await.unwrap();
        assert_eq!(
            owners,
            [
                (beta, Origin::Owner),
                (Permission::ManageChannels, Origin::Owner),
                (Permission::MoveMembers, Origin::Owner)
            ]
        );

        permissions::set(&pool, &owner, &kid, beta, false, NOW)
            .await
            .unwrap();
        assert!(!permissions::has(&pool, &kid, beta).await.unwrap());
    }

    #[tokio::test]
    async fn chave_de_permissao_desconhecida_e_ignorada() {
        let (pool, owner) = setup().await;
        let (kid, _) = join(&pool, &owner, "Kid", 1).await;
        sqlx::query(
            "INSERT INTO user_permissions (user_id, permission, granted_at) VALUES (?, 'futura.coisa', 0)",
        )
        .bind(&kid.id)
        .execute(&pool)
        .await
        .unwrap();
        assert!(
            permissions::effective(&pool, &kid)
                .await
                .unwrap()
                .is_empty()
        );
    }

    // --------------------------------------------------------- concorrência

    #[tokio::test]
    async fn o_ultimo_lugar_do_convite_vai_para_um_so() {
        let (path, url) = temp_db();
        let pool = db::connect(&url).await.unwrap();
        let owner = users::create_owner(&pool, "Dono", NOW).await.unwrap();
        let code = new_invite(&pool, &owner, HOUR, 1).await;

        let (key_a, key_b) = (key(1), key(2));
        let (a, b) = tokio::join!(
            invites::redeem(&pool, &code, &key_a, Some("Ana"), NOW),
            invites::redeem(&pool, &code, &key_b, Some("Beto"), NOW),
        );

        let members = users::list(&pool).await.unwrap().len();
        let uses: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM invite_uses")
            .fetch_one(&pool)
            .await
            .unwrap();
        pool.close().await;
        remove_db(&path);

        assert_eq!(successes(&a, &b), 1);
        assert!(
            matches!(a, Err(ApiError::InvalidInvite)) || matches!(b, Err(ApiError::InvalidInvite))
        );
        assert_eq!(members, 2); // o dono e quem entrou
        assert_eq!(uses, 1);
    }

    #[tokio::test]
    async fn a_mesma_chave_em_dois_convites_ao_mesmo_tempo_entra_uma_vez() {
        let (path, url) = temp_db();
        let pool = db::connect(&url).await.unwrap();
        let owner = users::create_owner(&pool, "Dono", NOW).await.unwrap();
        let code_a = new_invite(&pool, &owner, HOUR, 1).await;
        let code_b = new_invite(&pool, &owner, HOUR, 1).await;

        let shared = key(1);
        let (a, b) = tokio::join!(
            invites::redeem(&pool, &code_a, &shared, Some("Ana"), NOW),
            invites::redeem(&pool, &code_b, &shared, Some("Beto"), NOW),
        );

        let devices_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM devices")
            .fetch_one(&pool)
            .await
            .unwrap();
        pool.close().await;
        remove_db(&path);

        assert_eq!(successes(&a, &b), 1);
        assert!(
            matches!(a, Err(ApiError::DeviceAlreadyLinked))
                || matches!(b, Err(ApiError::DeviceAlreadyLinked))
        );
        assert_eq!(devices_count, 1);
    }
}
/// v0.2.2, 1.1: nome visível, busca pelo id e os modelos de convite, direto
/// sobre o banco.
mod nome_e_modelos {
    use api::db;
    use api::error::ApiError;
    use api::identity::invites::{self, InviteKind, NewInvite, Preset};
    use api::identity::{User, users};
    use sqlx::SqlitePool;

    const NOW: i64 = 1_000_000;
    const DAY: i64 = 24 * 60 * 60;

    async fn setup() -> (SqlitePool, User) {
        let pool = db::connect_in_memory().await.unwrap();
        let owner = users::create_owner(&pool, "Dono", NOW).await.unwrap();
        (pool, owner)
    }

    /// Um membro novo com esse nick.
    async fn join(pool: &SqlitePool, owner: &User, nick: &str, n: u8) -> User {
        let code = invites::create(pool, owner, InviteKind::New, None, DAY, 1, NOW)
            .await
            .unwrap()
            .code;
        let key = format!("{n:02x}").repeat(32);
        invites::redeem(pool, &code, &key, Some(nick), NOW)
            .await
            .unwrap()
            .user
    }

    async fn stored_preset(pool: &SqlitePool, id: &str) -> Option<String> {
        sqlx::query_scalar("SELECT preset FROM invites WHERE id = ?")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn nome_visivel_troca_e_volta_para_o_nick() {
        let (pool, owner) = setup().await;
        let kid = join(&pool, &owner, "kid", 1).await;
        assert_eq!(kid.display_name, None);
        assert_eq!(kid.shown_name(), "kid");

        let kid = users::set_display_name(&pool, &kid, Some("  Kid Bengala "))
            .await
            .unwrap();
        assert_eq!(kid.display_name.as_deref(), Some("Kid Bengala"));
        assert_eq!(kid.shown_name(), "Kid Bengala");
        // Gravou mesmo: quem lê do banco vê o nome novo.
        let again = users::get_by_id(&pool, &kid.id).await.unwrap();
        assert_eq!(again.display_name.as_deref(), Some("Kid Bengala"));

        // Vazio e `None` voltam para o nick.
        for blank in [Some(""), Some("   "), None] {
            let back = users::set_display_name(&pool, &kid, blank).await.unwrap();
            assert_eq!(back.display_name, None, "{blank:?}");
            assert_eq!(back.shown_name(), "kid");
        }
    }

    #[tokio::test]
    async fn nome_visivel_pode_repetir_e_nao_vira_nick() {
        let (pool, owner) = setup().await;
        let kid = join(&pool, &owner, "kid", 1).await;
        let ju = join(&pool, &owner, "juliana", 2).await;

        users::set_display_name(&pool, &kid, Some("juju"))
            .await
            .unwrap();
        users::set_display_name(&pool, &ju, Some("juju"))
            .await
            .unwrap();
        // Até o nick de outra pessoa serve de nome visível.
        users::set_display_name(&pool, &kid, Some("juliana"))
            .await
            .unwrap();

        // O nick continua livre e único: o nome visível não ocupa nick.
        assert!(
            users::find_active_by_nick(&pool, "juju")
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn nome_visivel_invalido_nao_muda_nada() {
        let (pool, owner) = setup().await;
        let kid = join(&pool, &owner, "kid", 1).await;
        let kid = users::set_display_name(&pool, &kid, Some("Kid"))
            .await
            .unwrap();

        for bad in ["dois  espacos", "emoji 😀", &"a".repeat(33)] {
            let result = users::set_display_name(&pool, &kid, Some(bad)).await;
            assert!(
                matches!(result, Err(ApiError::InvalidDisplayName(_))),
                "{bad:?}"
            );
        }
        let again = users::get_by_id(&pool, &kid.id).await.unwrap();
        assert_eq!(again.display_name.as_deref(), Some("Kid"));
    }

    #[tokio::test]
    async fn removido_nao_troca_o_nome() {
        let (pool, owner) = setup().await;
        let kid = join(&pool, &owner, "kid", 1).await;
        users::remove(&pool, &owner, &kid, NOW).await.unwrap();
        let result = users::set_display_name(&pool, &kid, Some("Kid")).await;
        assert!(matches!(result, Err(ApiError::Unauthenticated)));
    }

    #[tokio::test]
    async fn busca_pelo_id_acha_ate_removido() {
        let (pool, owner) = setup().await;
        let kid = join(&pool, &owner, "kid", 1).await;
        users::remove(&pool, &owner, &kid, NOW).await.unwrap();

        let found = users::get_by_id(&pool, &kid.id).await.unwrap();
        assert_eq!(found.nick, "kid");
        assert!(!found.is_active());
        assert!(matches!(
            users::get_by_id(&pool, "nao-existe").await,
            Err(ApiError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn modelos_fixos_usam_os_numeros_da_api() {
        let (pool, owner) = setup().await;

        let person = invites::create_new(&pool, &owner, NewInvite::Person, NOW)
            .await
            .unwrap();
        assert_eq!(person.expires_at, NOW + 7 * DAY);
        assert_eq!(person.max_uses, 1);
        assert_eq!(person.preset, Some(Preset::Person));
        assert_eq!(
            stored_preset(&pool, &person.id).await.as_deref(),
            Some("person")
        );

        let group = invites::create_new(&pool, &owner, NewInvite::Group, NOW)
            .await
            .unwrap();
        assert_eq!(group.expires_at, NOW + 5 * 60);
        assert_eq!(group.max_uses, 8);
        assert_eq!(
            stored_preset(&pool, &group.id).await.as_deref(),
            Some("group")
        );
    }

    #[tokio::test]
    async fn do_seu_jeito_guarda_custom_mesmo_com_os_numeros_de_um_modelo() {
        let (pool, owner) = setup().await;
        let custom = NewInvite::Custom {
            ttl_secs: 7 * DAY,
            max_uses: 1,
        };
        let invite = invites::create_new(&pool, &owner, custom, NOW)
            .await
            .unwrap();
        assert_eq!(invite.preset, Some(Preset::Custom));
        assert_eq!(
            stored_preset(&pool, &invite.id).await.as_deref(),
            Some("custom")
        );
    }

    #[tokio::test]
    async fn do_seu_jeito_fora_dos_limites_e_recusado() {
        let (pool, owner) = setup().await;
        for (ttl_secs, max_uses) in [(59, 1), (30 * DAY + 1, 1), (DAY, 0), (DAY, 51)] {
            let custom = NewInvite::Custom { ttl_secs, max_uses };
            let result = invites::create_new(&pool, &owner, custom, NOW).await;
            assert!(
                matches!(result, Err(ApiError::InvalidRequest(_))),
                "{ttl_secs} {max_uses}"
            );
        }
        for (ttl_secs, max_uses) in [(60, 1), (30 * DAY, 50)] {
            let custom = NewInvite::Custom { ttl_secs, max_uses };
            assert!(
                invites::create_new(&pool, &owner, custom, NOW)
                    .await
                    .is_ok()
            );
        }
    }

    #[tokio::test]
    async fn sem_modelo_escolhido_o_modelo_sai_dos_numeros() {
        // O caminho do `admin convite`: ele só dá validade e usos.
        let (pool, owner) = setup().await;
        let cases = [
            (7 * DAY, 1, "person"),
            (5 * 60, 8, "group"),
            (7 * DAY, 2, "custom"),
            (60 * 60, 1, "custom"),
        ];
        for (ttl, uses, expected) in cases {
            let invite = invites::create(&pool, &owner, InviteKind::New, None, ttl, uses, NOW)
                .await
                .unwrap();
            assert_eq!(
                stored_preset(&pool, &invite.id).await.as_deref(),
                Some(expected),
                "{ttl} {uses}"
            );
        }

        // A recuperação não tem modelo.
        let recovery = invites::create(
            &pool,
            &owner,
            InviteKind::Recovery,
            Some(&owner),
            DAY,
            1,
            NOW,
        )
        .await
        .unwrap();
        assert_eq!(recovery.preset, None);
        assert_eq!(stored_preset(&pool, &recovery.id).await, None);
    }

    #[tokio::test]
    async fn membro_nao_cria_convite_com_modelo() {
        let (pool, owner) = setup().await;
        let kid = join(&pool, &owner, "kid", 1).await;
        let result = invites::create_new(&pool, &kid, NewInvite::Group, NOW).await;
        assert!(matches!(result, Err(ApiError::Forbidden)));
    }
}

/// Vincula o primeiro computador do dono (com uma recuperação para ele mesmo) e
/// devolve o token.
async fn owner_session(ctx: &Ctx, device: u8) -> String {
    let recovery = invites::create(
        &ctx.db,
        &ctx.owner,
        InviteKind::Recovery,
        Some(&ctx.owner),
        DAY,
        1,
        now(),
    )
    .await
    .unwrap();
    let (_, body) = redeem(ctx, &recovery.code, device, "").await;
    body["token"].as_str().unwrap().to_owned()
}

/// v0.2.2, 1.2: ler o convite antes de usar, o nome visível pelo `/api/me` e o
/// que o app esconde ou mostra.
mod entrada_e_perfil {
    use super::*;

    async fn preview(ctx: &Ctx, code: &str) -> (StatusCode, Value) {
        call(
            &ctx.router,
            "GET",
            &format!("/api/invites/{code}"),
            None,
            None,
        )
        .await
    }

    #[tokio::test]
    async fn ler_convite_novo_mostra_quem_convidou_sem_gastar() {
        let ctx = setup().await;
        let invite = invites::create(
            &ctx.db,
            &ctx.owner,
            InviteKind::New,
            None,
            7 * DAY,
            1,
            now(),
        )
        .await
        .unwrap();

        // Ler várias vezes, com o código digitado de outro jeito, não gasta o uso.
        for code in [invite.code.clone(), invite.code.to_lowercase()] {
            let (status, body) = preview(&ctx, &code).await;
            assert_eq!(status, StatusCode::OK, "{body}");
            assert_eq!(
                body,
                json!({
                    "kind": "new",
                    "invited_by": { "nick": "Kid", "display_name": null },
                    "expires_at": invite.expires_at,
                })
            );
        }
        assert_eq!(
            redeem(&ctx, &invite.code, 1, "Fulano").await.0,
            StatusCode::OK
        );
    }

    #[tokio::test]
    async fn ler_recuperacao_mostra_a_conta_com_o_nome_visivel() {
        let ctx = setup().await;
        session(&ctx, "juliana", 1).await;
        let ju = users::get_active_by_nick(&ctx.db, "juliana").await.unwrap();
        let ju = users::set_display_name(&ctx.db, &ju, Some("juju"))
            .await
            .unwrap();
        let recovery = invites::create(
            &ctx.db,
            &ctx.owner,
            InviteKind::Recovery,
            Some(&ju),
            DAY,
            1,
            now(),
        )
        .await
        .unwrap();

        let (status, body) = preview(&ctx, &recovery.code).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(
            body,
            json!({
                "kind": "recovery",
                "account": { "nick": "juliana", "display_name": "juju" },
                "expires_at": recovery.expires_at,
            })
        );
        // Nada de id: a rota não tem sessão.
        assert!(body["account"].get("id").is_none());
    }

    #[tokio::test]
    async fn convite_que_nao_vale_da_o_mesmo_erro_ao_ler() {
        let ctx = setup().await;
        let expired = invites::create(
            &ctx.db,
            &ctx.owner,
            InviteKind::New,
            None,
            60,
            1,
            now() - 120,
        )
        .await
        .unwrap();
        let revoked = invites::create(&ctx.db, &ctx.owner, InviteKind::New, None, DAY, 1, now())
            .await
            .unwrap();
        invites::revoke(&ctx.db, &ctx.owner, &revoked.id, now())
            .await
            .unwrap();
        let used = new_invite(&ctx).await;
        redeem(&ctx, &used, 1, "Fulano").await;

        // A recuperação de quem foi removido também não vale.
        let fulano = users::get_active_by_nick(&ctx.db, "Fulano").await.unwrap();
        let orphan = invites::create(
            &ctx.db,
            &ctx.owner,
            InviteKind::Recovery,
            Some(&fulano),
            DAY,
            1,
            now(),
        )
        .await
        .unwrap();
        users::remove(&ctx.db, &ctx.owner, &fulano, now())
            .await
            .unwrap();

        for code in [
            "AAAA-AAAA-AAAA",
            "nao-e-codigo",
            &expired.code,
            &revoked.code,
            &used,
            &orphan.code,
        ] {
            let (status, body) = preview(&ctx, code).await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "{code}");
            assert_eq!(body["kind"], "invalid_invite", "{code}");
        }
    }

    #[tokio::test]
    async fn ler_codigo_errado_conta_no_limite() {
        let ctx = setup().await;
        let code = new_invite(&ctx).await;
        for _ in 0..20 {
            assert_eq!(
                preview(&ctx, "AAAA-AAAA-AAAA").await.0,
                StatusCode::BAD_REQUEST
            );
        }
        // Travou a leitura e o uso, até de um convite que vale.
        let (status, body) = preview(&ctx, &code).await;
        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(body["kind"], "too_many_attempts");
        assert_eq!(
            redeem(&ctx, &code, 1, "Fulano").await.0,
            StatusCode::TOO_MANY_REQUESTS
        );
    }

    #[tokio::test]
    async fn ler_convite_valido_nao_conta_no_limite() {
        let ctx = setup().await;
        let code = new_invite(&ctx).await;
        for _ in 0..25 {
            assert_eq!(preview(&ctx, &code).await.0, StatusCode::OK);
        }
        assert_eq!(redeem(&ctx, &code, 1, "Fulano").await.0, StatusCode::OK);
    }

    #[tokio::test]
    async fn patch_me_troca_e_limpa_o_nome_visivel() {
        let ctx = setup().await;
        let token = session(&ctx, "juliana", 1).await;

        let (status, body) = call(
            &ctx.router,
            "PATCH",
            "/api/me",
            Some(&token),
            Some(json!({ "display_name": "  juju " })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["user"]["nick"], "juliana");
        assert_eq!(body["user"]["display_name"], "juju");
        // A resposta é a do `GET /api/me`.
        assert_eq!(body["update_channel"], "stable");

        let (_, me) = call(&ctx.router, "GET", "/api/me", Some(&token), None).await;
        assert_eq!(me["user"]["display_name"], "juju");

        // Texto vazio, `null` e campo ausente voltam para o nick.
        for clear in [
            json!({ "display_name": "" }),
            json!({ "display_name": null }),
            json!({}),
        ] {
            let (status, body) =
                call(&ctx.router, "PATCH", "/api/me", Some(&token), Some(clear)).await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(body["user"]["display_name"], Value::Null);
        }
    }

    #[tokio::test]
    async fn patch_me_recusa_nome_invalido_com_mensagem_pronta() {
        let ctx = setup().await;
        let token = session(&ctx, "juliana", 1).await;

        for bad in ["dois  espacos", "emoji 😀", &"a".repeat(33)] {
            let (status, body) = call(
                &ctx.router,
                "PATCH",
                "/api/me",
                Some(&token),
                Some(json!({ "display_name": bad })),
            )
            .await;
            assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{bad}");
            assert_eq!(body["kind"], "invalid_display_name", "{bad}");
            assert!(body["message"].as_str().unwrap().contains("nome visível"));
        }

        // Tipo errado no corpo é `invalid_request`; sem sessão, 401.
        let (status, body) = call(
            &ctx.router,
            "PATCH",
            "/api/me",
            Some(&token),
            Some(json!({ "display_name": 5 })),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body["kind"], "invalid_request");
        let (status, _) = call(
            &ctx.router,
            "PATCH",
            "/api/me",
            None,
            Some(json!({ "display_name": "juju" })),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn me_diz_quem_ve_o_painel() {
        let ctx = setup().await;
        let member = session(&ctx, "juliana", 1).await;
        let owner = owner_session(&ctx, 2).await;

        let (_, me) = call(&ctx.router, "GET", "/api/me", Some(&member), None).await;
        assert_eq!(me["can_view_panel"], false);
        assert_eq!(me["user"]["display_name"], Value::Null);

        let (_, me) = call(&ctx.router, "GET", "/api/me", Some(&owner), None).await;
        assert_eq!(me["can_view_panel"], true);
        assert_eq!(me["can_create_invite"], true);
    }

    #[tokio::test]
    async fn o_login_devolve_o_nome_visivel() {
        let ctx = setup().await;
        session(&ctx, "juliana", 1).await;
        let ju = users::get_active_by_nick(&ctx.db, "juliana").await.unwrap();
        users::set_display_name(&ctx.db, &ju, Some("juju"))
            .await
            .unwrap();

        let (status, body) = call(
            &ctx.router,
            "POST",
            "/api/auth/login",
            None,
            Some(json!({ "device_key": key(1) })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["user"]["display_name"], "juju");
    }
}

/// v0.2.2, 1.3: as nove rotas do Painel, pelo HTTP.
mod painel {
    use super::*;

    /// Entra com `nick` e devolve o token e o membro.
    async fn member(ctx: &Ctx, nick: &str, device: u8) -> (String, User) {
        let token = session(ctx, nick, device).await;
        let user = users::get_active_by_nick(&ctx.db, nick).await.unwrap();
        (token, user)
    }

    /// Cria um convite pela rota e devolve a resposta.
    async fn create_invite(ctx: &Ctx, owner: &str, body: Value) -> Value {
        let (status, created) =
            call(&ctx.router, "POST", "/api/invites", Some(owner), Some(body)).await;
        assert_eq!(status, StatusCode::CREATED, "{created}");
        created
    }

    fn find<'a>(list: &'a Value, field: &str, value: &str) -> &'a Value {
        list.as_array()
            .unwrap()
            .iter()
            .find(|item| item[field] == value)
            .unwrap_or_else(|| panic!("{field} = {value} não está na lista"))
    }

    #[tokio::test]
    async fn membro_nao_ve_nem_mexe_no_painel() {
        let ctx = setup().await;
        let (token, ju) = member(&ctx, "juliana", 1).await;
        let invite = invites::create(&ctx.db, &ctx.owner, InviteKind::New, None, DAY, 1, now())
            .await
            .unwrap();

        let id = &ju.id;
        let routes = [
            (
                "POST",
                "/api/invites".to_owned(),
                Some(json!({ "preset": "person" })),
            ),
            ("GET", "/api/invites".to_owned(), None),
            ("POST", format!("/api/invites/{}/revoke", invite.id), None),
            ("GET", "/api/members".to_owned(), None),
            ("GET", format!("/api/members/{id}/permissions"), None),
            (
                "PUT",
                format!("/api/members/{id}/beta"),
                Some(json!({ "enabled": true })),
            ),
            ("POST", format!("/api/members/{id}/unlink"), None),
            ("POST", format!("/api/members/{id}/recovery-invite"), None),
            ("DELETE", format!("/api/members/{id}"), None),
        ];
        for (method, uri, body) in &routes {
            let (status, response) =
                call(&ctx.router, method, uri, Some(&token), body.clone()).await;
            assert_eq!(status, StatusCode::FORBIDDEN, "{method} {uri}");
            assert_eq!(response["kind"], "forbidden", "{method} {uri}");

            let (status, _) = call(&ctx.router, method, uri, None, body.clone()).await;
            assert_eq!(status, StatusCode::UNAUTHORIZED, "{method} {uri}");
        }

        // Nada mudou: a sessão vale, sem beta, e o convite continua servindo.
        let (status, me) = call(&ctx.router, "GET", "/api/me", Some(&token), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(me["update_channel"], "stable");
        assert_eq!(
            redeem(&ctx, &invite.code, 2, "Fulano").await.0,
            StatusCode::OK
        );
    }

    #[tokio::test]
    async fn criar_convite_pelos_modelos() {
        let ctx = setup().await;
        let owner = owner_session(&ctx, 9).await;
        let before = now();

        let person = create_invite(&ctx, &owner, json!({ "preset": "person" })).await;
        let code = person["code"].as_str().unwrap();
        assert_eq!(person["preset"], "person");
        assert_eq!(person["max_uses"], 1);
        assert_eq!(person["link"], format!("https://ashtar.test/invite/{code}"));
        let expires = person["expires_at"].as_i64().unwrap();
        assert!((before + 7 * DAY..=now() + 7 * DAY).contains(&expires));
        assert_eq!(redeem(&ctx, code, 1, "Fulano").await.0, StatusCode::OK);

        // Nos modelos fixos, os números do corpo são ignorados.
        let group = create_invite(
            &ctx,
            &owner,
            json!({ "preset": "group", "ttl_secs": 30 * DAY, "max_uses": 50 }),
        )
        .await;
        assert_eq!(group["preset"], "group");
        assert_eq!(group["max_uses"], 8);
        let expires = group["expires_at"].as_i64().unwrap();
        assert!((before + 5 * 60..=now() + 5 * 60).contains(&expires));

        let custom = create_invite(
            &ctx,
            &owner,
            json!({ "preset": "custom", "ttl_secs": 3600, "max_uses": 3 }),
        )
        .await;
        assert_eq!(custom["preset"], "custom");
        assert_eq!(custom["max_uses"], 3);
        let expires = custom["expires_at"].as_i64().unwrap();
        assert!((before + 3600..=now() + 3600).contains(&expires));
    }

    #[tokio::test]
    async fn convite_fora_dos_limites_e_recusado() {
        let ctx = setup().await;
        let owner = owner_session(&ctx, 9).await;

        for body in [
            json!({ "preset": "custom" }),
            json!({ "preset": "custom", "ttl_secs": 3600 }),
            json!({ "preset": "custom", "ttl_secs": 59, "max_uses": 1 }),
            json!({ "preset": "custom", "ttl_secs": 30 * DAY + 1, "max_uses": 1 }),
            json!({ "preset": "custom", "ttl_secs": 3600, "max_uses": 0 }),
            json!({ "preset": "custom", "ttl_secs": 3600, "max_uses": 51 }),
            json!({ "preset": "outro" }),
            json!({}),
        ] {
            let (status, response) = call(
                &ctx.router,
                "POST",
                "/api/invites",
                Some(&owner),
                Some(body.clone()),
            )
            .await;
            assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
            assert_eq!(response["kind"], "invalid_request", "{body}");
        }
        // Só o convite de recuperação do dono, que vinculou o computador dele.
        assert_eq!(invites::list(&ctx.db).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn historico_de_convites() {
        let ctx = setup().await;
        let owner = owner_session(&ctx, 9).await;

        let group = create_invite(&ctx, &owner, json!({ "preset": "group" })).await;
        let code = group["code"].as_str().unwrap();
        redeem(&ctx, code, 1, "juliana").await;
        redeem(&ctx, code, 2, "carla").await;
        let ju = users::get_active_by_nick(&ctx.db, "juliana").await.unwrap();
        users::set_display_name(&ctx.db, &ju, Some("juju"))
            .await
            .unwrap();

        let person = create_invite(&ctx, &owner, json!({ "preset": "person" })).await;
        let uri = format!("/api/invites/{}/revoke", person["id"].as_str().unwrap());
        assert_eq!(
            call(&ctx.router, "POST", &uri, Some(&owner), None).await.0,
            StatusCode::NO_CONTENT
        );

        let (status, list) = call(&ctx.router, "GET", "/api/invites", Some(&owner), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(list.as_array().unwrap().len(), 3);

        let group = find(&list, "id", group["id"].as_str().unwrap());
        assert_eq!(group["kind"], "new");
        assert_eq!(group["preset"], "group");
        assert_eq!(group["status"], "pending");
        assert_eq!(group["max_uses"], 8);
        assert_eq!(group["created_by"]["id"], ctx.owner.id.as_str());
        assert_eq!(group["created_by"]["nick"], "Kid");
        assert_eq!(group["target"], Value::Null);
        assert_eq!(group["uses"][0]["user"]["id"], ju.id.as_str());
        assert_eq!(group["uses"][0]["user"]["nick"], "juliana");
        assert_eq!(group["uses"][0]["user"]["display_name"], "juju");
        assert!(group["uses"][0]["used_at"].is_i64());
        assert_eq!(group["uses"][1]["user"]["nick"], "carla");
        // O código não volta depois da criação.
        assert!(group.get("code").is_none() && group.get("link").is_none());

        let person = find(&list, "id", person["id"].as_str().unwrap());
        assert_eq!(person["status"], "revoked");
        assert!(person["revoked_at"].is_i64());
        assert_eq!(person["uses"], json!([]));

        let recovery = find(&list, "kind", "recovery");
        assert_eq!(recovery["preset"], Value::Null);
        assert_eq!(recovery["status"], "exhausted");
        assert_eq!(recovery["target"]["nick"], "Kid");
    }

    #[tokio::test]
    async fn revogar_pelo_id_inteiro() {
        let ctx = setup().await;
        let owner = owner_session(&ctx, 9).await;
        let revoke = |id: &str| format!("/api/invites/{id}/revoke");

        let created = create_invite(&ctx, &owner, json!({ "preset": "person" })).await;
        let id = created["id"].as_str().unwrap();

        // O começo do id fica só no `admin`.
        let (status, body) = call(&ctx.router, "POST", &revoke(&id[..8]), Some(&owner), None).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["kind"], "not_found");

        let (status, _) = call(&ctx.router, "POST", &revoke(id), Some(&owner), None).await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let (status, body) = call(&ctx.router, "POST", &revoke(id), Some(&owner), None).await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(body["kind"], "conflict");
        assert_eq!(
            redeem(&ctx, created["code"].as_str().unwrap(), 1, "Fulano")
                .await
                .0,
            StatusCode::BAD_REQUEST
        );

        // Já usado por completo: 409.
        let used = create_invite(&ctx, &owner, json!({ "preset": "person" })).await;
        redeem(&ctx, used["code"].as_str().unwrap(), 1, "Fulano").await;
        let uri = revoke(used["id"].as_str().unwrap());
        assert_eq!(
            call(&ctx.router, "POST", &uri, Some(&owner), None).await.0,
            StatusCode::CONFLICT
        );
    }

    #[tokio::test]
    async fn lista_de_membros_numa_chamada() {
        let ctx = setup().await;
        let owner = owner_session(&ctx, 9).await;

        // juliana: convite para uma pessoa, nome visível e beta.
        let person = create_invite(&ctx, &owner, json!({ "preset": "person" })).await;
        redeem(&ctx, person["code"].as_str().unwrap(), 1, "juliana").await;
        let ju = users::get_active_by_nick(&ctx.db, "juliana").await.unwrap();
        users::set_display_name(&ctx.db, &ju, Some("juju"))
            .await
            .unwrap();
        let uri = format!("/api/members/{}/beta", ju.id);
        let body = Some(json!({ "enabled": true }));
        call(&ctx.router, "PUT", &uri, Some(&owner), body).await;

        // carla e pedro: o convite do grupo. carla fica sem computador, com duas
        // recuperações valendo; pedro, com uma que já venceu.
        let group = create_invite(&ctx, &owner, json!({ "preset": "group" })).await;
        let code = group["code"].as_str().unwrap();
        redeem(&ctx, code, 2, "carla").await;
        redeem(&ctx, code, 3, "pedro").await;
        let carla = users::get_active_by_nick(&ctx.db, "carla").await.unwrap();
        let pedro = users::get_active_by_nick(&ctx.db, "pedro").await.unwrap();
        let uri = format!("/api/members/{}/unlink", carla.id);
        call(&ctx.router, "POST", &uri, Some(&owner), None).await;
        invites::create(
            &ctx.db,
            &ctx.owner,
            InviteKind::Recovery,
            Some(&carla),
            DAY,
            1,
            now(),
        )
        .await
        .unwrap();
        let uri = format!("/api/members/{}/recovery-invite", carla.id);
        let (_, recovery) = call(&ctx.router, "POST", &uri, Some(&owner), None).await;
        invites::create(
            &ctx.db,
            &ctx.owner,
            InviteKind::Recovery,
            Some(&pedro),
            60,
            1,
            now() - 120,
        )
        .await
        .unwrap();

        // bruno: do seu jeito, com beta, e removido.
        let custom = create_invite(
            &ctx,
            &owner,
            json!({ "preset": "custom", "ttl_secs": DAY, "max_uses": 1 }),
        )
        .await;
        redeem(&ctx, custom["code"].as_str().unwrap(), 4, "bruno").await;
        let bruno = users::get_active_by_nick(&ctx.db, "bruno").await.unwrap();
        let uri = format!("/api/members/{}/beta", bruno.id);
        call(
            &ctx.router,
            "PUT",
            &uri,
            Some(&owner),
            Some(json!({ "enabled": true })),
        )
        .await;
        let uri = format!("/api/members/{}", bruno.id);
        call(&ctx.router, "DELETE", &uri, Some(&owner), None).await;

        let (status, list) = call(&ctx.router, "GET", "/api/members", Some(&owner), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(list.as_array().unwrap().len(), 5);

        let kid = find(&list, "nick", "Kid");
        assert_eq!(kid["id"], ctx.owner.id.as_str());
        assert_eq!(kid["is_owner"], true);
        assert!(kid["device"]["linked_at"].is_i64());
        assert_eq!(
            kid["beta"],
            json!({ "origin": "owner", "granted_at": null })
        );
        assert_eq!(kid["joined_with"], Value::Null);

        let ju = find(&list, "nick", "juliana");
        assert_eq!(ju["display_name"], "juju");
        assert_eq!(ju["is_owner"], false);
        assert!(ju["created_at"].is_i64());
        assert_eq!(ju["removed_at"], Value::Null);
        assert!(ju["device"]["linked_at"].is_i64());
        assert_eq!(ju["beta"]["origin"], "direct");
        assert!(ju["beta"]["granted_at"].is_i64());
        assert_eq!(
            ju["joined_with"],
            json!({ "invite_id": person["id"], "preset": "person", "uses": 1, "max_uses": 1 })
        );
        assert_eq!(ju["pending_recovery"], Value::Null);

        let carla = find(&list, "nick", "carla");
        assert_eq!(carla["device"], Value::Null);
        assert_eq!(carla["beta"], Value::Null);
        assert_eq!(
            carla["joined_with"],
            json!({ "invite_id": group["id"], "preset": "group", "uses": 2, "max_uses": 8 })
        );
        // Das duas recuperações valendo, a que vence por último.
        assert_eq!(
            carla["pending_recovery"],
            json!({ "invite_id": recovery["id"], "expires_at": recovery["expires_at"] })
        );

        let pedro = find(&list, "nick", "pedro");
        assert!(pedro["device"]["linked_at"].is_i64());
        assert_eq!(pedro["pending_recovery"], Value::Null);

        let bruno = find(&list, "nick", "bruno");
        assert!(bruno["removed_at"].is_i64());
        assert_eq!(bruno["device"], Value::Null);
        assert_eq!(bruno["beta"], Value::Null);
        assert_eq!(bruno["joined_with"]["preset"], "custom");
    }

    #[tokio::test]
    async fn permissoes_de_cada_um_e_de_onde_vem() {
        let ctx = setup().await;
        let owner = owner_session(&ctx, 9).await;
        let (_, ju) = member(&ctx, "juliana", 1).await;
        let permissions_of = |id: &str| format!("/api/members/{id}/permissions");

        let (status, list) = call(
            &ctx.router,
            "GET",
            &permissions_of(&ctx.owner.id),
            Some(&owner),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let keys: Vec<&str> = list
            .as_array()
            .unwrap()
            .iter()
            .map(|g| g["key"].as_str().unwrap())
            .collect();
        assert_eq!(
            keys,
            [
                "atualizacoes.beta",
                "canais.gerenciar",
                "membros.mover",
                "convites.criar",
                "convites.recuperacao",
                "convites.revogar",
                "membros.desvincular",
                "membros.remover",
                "permissoes.gerenciar",
                "painel.ver",
            ]
        );
        assert_eq!(
            list[0],
            json!({
                "key": "atualizacoes.beta",
                "kind": "permission",
                "label": "Receber o beta",
                "granted": true,
                "origin": "owner",
                "granted_at": null,
            })
        );
        assert_eq!(list[1]["key"], "canais.gerenciar");
        assert_eq!(list[1]["kind"], "permission");
        assert_eq!(list[2]["key"], "membros.mover");
        assert_eq!(list[2]["kind"], "permission");
        // As permissões vêm antes das ações.
        for grant in list.as_array().unwrap()[3..].iter() {
            assert_eq!(grant["kind"], "action");
            assert_eq!(grant["granted"], true);
            assert_eq!(grant["origin"], "owner");
        }

        // Membro sem nada.
        let (_, list) = call(
            &ctx.router,
            "GET",
            &permissions_of(&ju.id),
            Some(&owner),
            None,
        )
        .await;
        for grant in list.as_array().unwrap() {
            assert_eq!(grant["granted"], false, "{grant}");
            assert_eq!(grant["origin"], Value::Null, "{grant}");
        }

        // Com o beta ligado pelo dono.
        let uri = format!("/api/members/{}/beta", ju.id);
        call(
            &ctx.router,
            "PUT",
            &uri,
            Some(&owner),
            Some(json!({ "enabled": true })),
        )
        .await;
        let (_, list) = call(
            &ctx.router,
            "GET",
            &permissions_of(&ju.id),
            Some(&owner),
            None,
        )
        .await;
        assert_eq!(list[0]["granted"], true);
        assert_eq!(list[0]["origin"], "direct");
        assert!(list[0]["granted_at"].is_i64());
        assert_eq!(list[1]["granted"], false);

        // Removido não tem nenhuma, nem a que tinha.
        users::remove(&ctx.db, &ctx.owner, &ju, now())
            .await
            .unwrap();
        let (_, list) = call(
            &ctx.router,
            "GET",
            &permissions_of(&ju.id),
            Some(&owner),
            None,
        )
        .await;
        assert!(
            list.as_array()
                .unwrap()
                .iter()
                .all(|g| g["granted"] == false)
        );

        let (status, body) = call(
            &ctx.router,
            "GET",
            &permissions_of("nao-existe"),
            Some(&owner),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["kind"], "not_found");
    }

    #[tokio::test]
    async fn beta_pela_rota() {
        let ctx = setup().await;
        let owner = owner_session(&ctx, 9).await;
        let (token, ju) = member(&ctx, "juliana", 1).await;
        let beta = |id: &str| format!("/api/members/{id}/beta");
        let set = |enabled: bool| Some(json!({ "enabled": enabled }));

        for _ in 0..2 {
            let (status, _) =
                call(&ctx.router, "PUT", &beta(&ju.id), Some(&owner), set(true)).await;
            assert_eq!(status, StatusCode::NO_CONTENT);
        }
        let (_, me) = call(&ctx.router, "GET", "/api/me", Some(&token), None).await;
        assert_eq!(me["update_channel"], "beta");

        let (status, _) = call(&ctx.router, "PUT", &beta(&ju.id), Some(&owner), set(false)).await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let (_, me) = call(&ctx.router, "GET", "/api/me", Some(&token), None).await;
        assert_eq!(me["update_channel"], "stable");

        // O dono está sempre no beta.
        let (status, body) = call(
            &ctx.router,
            "PUT",
            &beta(&ctx.owner.id),
            Some(&owner),
            set(false),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(body["kind"], "conflict");

        for body in [json!({}), json!({ "enabled": "sim" })] {
            let (status, response) =
                call(&ctx.router, "PUT", &beta(&ju.id), Some(&owner), Some(body)).await;
            assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(response["kind"], "invalid_request");
        }
        let (status, _) = call(
            &ctx.router,
            "PUT",
            &beta("nao-existe"),
            Some(&owner),
            set(true),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        users::remove(&ctx.db, &ctx.owner, &ju, now())
            .await
            .unwrap();
        let (status, _) = call(&ctx.router, "PUT", &beta(&ju.id), Some(&owner), set(true)).await;
        assert_eq!(status, StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn desvincular_e_recuperar_pela_rota() {
        let ctx = setup().await;
        let owner = owner_session(&ctx, 9).await;
        let (token, ju) = member(&ctx, "juliana", 1).await;
        let unlink = format!("/api/members/{}/unlink", ju.id);
        let recovery = format!("/api/members/{}/recovery-invite", ju.id);

        let (status, _) = call(&ctx.router, "POST", &unlink, Some(&owner), None).await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        assert_eq!(
            call(&ctx.router, "GET", "/api/me", Some(&token), None)
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
        // Sem computador, não há o que desvincular.
        let (status, body) = call(&ctx.router, "POST", &unlink, Some(&owner), None).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["kind"], "not_found");

        let before = now();
        let (status, created) = call(&ctx.router, "POST", &recovery, Some(&owner), None).await;
        assert_eq!(status, StatusCode::CREATED, "{created}");
        let code = created["code"].as_str().unwrap();
        assert_eq!(
            created["link"],
            format!("https://ashtar.test/recovery/{code}")
        );
        assert_eq!(created["preset"], Value::Null);
        assert_eq!(created["max_uses"], 1);
        let expires = created["expires_at"].as_i64().unwrap();
        assert!((before + 7 * DAY..=now() + 7 * DAY).contains(&expires));

        let (status, body) = redeem(&ctx, code, 2, "").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["user"]["id"], ju.id.as_str());

        // Removido não ganha recuperação.
        users::remove(&ctx.db, &ctx.owner, &ju, now())
            .await
            .unwrap();
        let (status, _) = call(&ctx.router, "POST", &recovery, Some(&owner), None).await;
        assert_eq!(status, StatusCode::CONFLICT);

        for uri in [
            "/api/members/nao-existe/unlink",
            "/api/members/nao-existe/recovery-invite",
        ] {
            let (status, _) = call(&ctx.router, "POST", uri, Some(&owner), None).await;
            assert_eq!(status, StatusCode::NOT_FOUND, "{uri}");
        }
    }

    #[tokio::test]
    async fn remover_pela_rota() {
        let ctx = setup().await;
        let owner = owner_session(&ctx, 9).await;
        let (token, ju) = member(&ctx, "juliana", 1).await;
        let uri = format!("/api/members/{}", ju.id);

        let (status, _) = call(&ctx.router, "DELETE", &uri, Some(&owner), None).await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        assert_eq!(
            call(&ctx.router, "GET", "/api/me", Some(&token), None)
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
        let (status, _) = call(&ctx.router, "DELETE", &uri, Some(&owner), None).await;
        assert_eq!(status, StatusCode::CONFLICT);

        let owner_uri = format!("/api/members/{}", ctx.owner.id);
        let (status, body) = call(&ctx.router, "DELETE", &owner_uri, Some(&owner), None).await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(body["kind"], "conflict");
        let (status, _) = call(
            &ctx.router,
            "DELETE",
            "/api/members/nao-existe",
            Some(&owner),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        // O nick ficou livre.
        let code = new_invite(&ctx).await;
        assert_eq!(redeem(&ctx, &code, 1, "juliana").await.0, StatusCode::OK);
    }
}
/// v0.2.2, 1.4: quem está na sala. A conversa com o LiveKit fica de fora (os
/// testes não sobem um servidor de voz); a junção com o banco e as recusas antes
/// do LiveKit ficam aqui.
mod sala {
    use super::*;
    use api::voice::{RoomParticipant, join_participants};

    fn in_room(identity: &str, screen_sharing: bool) -> RoomParticipant {
        RoomParticipant {
            identity: identity.to_owned(),
            screen_sharing,
        }
    }

    #[tokio::test]
    async fn junta_quem_esta_na_sala_com_o_banco() {
        let ctx = setup().await;
        session(&ctx, "juliana", 1).await;
        session(&ctx, "carla", 2).await;
        let ju = users::get_active_by_nick(&ctx.db, "juliana").await.unwrap();
        let carla = users::get_active_by_nick(&ctx.db, "carla").await.unwrap();
        users::set_display_name(&ctx.db, &ju, Some("juju"))
            .await
            .unwrap();

        let room = vec![
            in_room(&carla.id, true),
            // O app antigo entra com outra identidade: fica de fora.
            in_room("idiot-1234", false),
            in_room(&ju.id, false),
        ];
        let joined = join_participants(&ctx.db, room).await.unwrap();
        let json = serde_json::to_value(&joined).unwrap();
        assert_eq!(
            json,
            json!([
                { "user_id": carla.id, "nick": "carla", "display_name": null, "screen_sharing": true },
                { "user_id": ju.id, "nick": "juliana", "display_name": "juju", "screen_sharing": false },
            ])
        );
    }

    #[tokio::test]
    async fn sala_vazia_e_lista_vazia() {
        let ctx = setup().await;
        assert!(
            join_participants(&ctx.db, Vec::new())
                .await
                .unwrap()
                .is_empty()
        );
        let only_strangers = vec![in_room("idiot-1", false), in_room("idiot-2", true)];
        assert!(
            join_participants(&ctx.db, only_strangers)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn removido_ainda_conectado_aparece() {
        let ctx = setup().await;
        session(&ctx, "bruno", 1).await;
        let bruno = users::get_active_by_nick(&ctx.db, "bruno").await.unwrap();
        users::remove(&ctx.db, &ctx.owner, &bruno, now())
            .await
            .unwrap();

        let joined = join_participants(&ctx.db, vec![in_room(&bruno.id, false)])
            .await
            .unwrap();
        assert_eq!(joined.len(), 1);
        assert_eq!(joined[0].nick, "bruno");
    }

    #[tokio::test]
    async fn rota_recusa_antes_de_perguntar_ao_livekit() {
        let ctx = setup().await;
        let token = session(&ctx, "juliana", 1).await;

        let (status, _) = call(
            &ctx.router,
            "GET",
            "/api/voice/participants?channel_id=jogatina",
            None,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);

        for uri in [
            "/api/voice/participants",
            "/api/voice/participants?channel_id=",
            "/api/voice/participants?channel_id=com%20espaco",
            "/api/voice/participants?channel_id=..%2Foutra",
        ] {
            let (status, body) = call(&ctx.router, "GET", uri, Some(&token), None).await;
            assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{uri}");
            assert_eq!(body["kind"], "invalid_request", "{uri}");
        }
    }
}
/// v0.2.2, 1.5: as páginas do convite, pelo HTTP. O texto exato de cada página
/// está nos testes de `routes::pages`; aqui ficam a rota, o limite e o banco.
mod pagina {
    use super::*;
    use axum::http::HeaderMap;
    use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};

    async fn get(router: &Router, uri: &str) -> (StatusCode, HeaderMap, Vec<u8>) {
        let request = Request::builder().uri(uri).body(Body::empty()).unwrap();
        let response = router.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (status, headers, bytes.to_vec())
    }

    async fn page(ctx: &Ctx, uri: &str) -> (StatusCode, String) {
        let (status, headers, body) = get(&ctx.router, uri).await;
        assert_eq!(headers[CONTENT_TYPE], "text/html; charset=utf-8", "{uri}");
        assert_eq!(headers[CACHE_CONTROL], "no-store", "{uri}");
        (status, String::from_utf8(body).unwrap())
    }

    #[tokio::test]
    async fn convite_valendo_mostra_quem_convidou_e_nao_gasta() {
        let ctx = setup().await;
        let code = new_invite(&ctx).await;

        // Digitado em minúsculas: os links saem no formato de sempre.
        let (status, html) = page(&ctx, &format!("/invite/{}", code.to_lowercase())).await;
        assert_eq!(status, StatusCode::OK);
        assert!(html.contains(r#"content="Kid te convidou para o Ashtar""#));
        assert!(html.contains(&format!(
            r#"<meta property="og:url" content="https://ashtar.test/invite/{code}">"#
        )));
        assert!(html.contains(r#"content="https://ashtar.test/invite.png""#));
        assert!(html.contains(&format!(r#"href="ashtar://invite/{code}""#)));
        assert!(html.contains(&format!(r#"data-link="https://ashtar.test/invite/{code}""#)));
        assert!(html.contains("Vale até "));

        assert_eq!(redeem(&ctx, &code, 1, "Fulano").await.0, StatusCode::OK);
    }

    #[tokio::test]
    async fn recuperacao_segue_o_tipo_do_convite() {
        let ctx = setup().await;
        session(&ctx, "juliana", 1).await;
        let ju = users::get_active_by_nick(&ctx.db, "juliana").await.unwrap();
        let ju = users::set_display_name(&ctx.db, &ju, Some("juju"))
            .await
            .unwrap();
        let recovery = invites::create(
            &ctx.db,
            &ctx.owner,
            InviteKind::Recovery,
            Some(&ju),
            DAY,
            1,
            now(),
        )
        .await
        .unwrap();

        // Aberto pelo caminho certo ou pelo outro, a página é a da recuperação.
        for path in ["recovery", "invite"] {
            let (status, html) = page(&ctx, &format!("/{path}/{}", recovery.code)).await;
            assert_eq!(status, StatusCode::OK);
            assert!(html.contains("<title>Trocar de computador no Ashtar</title>"));
            assert!(html.contains(r#"Conta de <span class="conta">juju</span>"#));
            assert!(html.contains(&format!(r#"href="ashtar://recovery/{}""#, recovery.code)));
        }
    }

    #[tokio::test]
    async fn convite_que_nao_vale_responde_200_sem_dizer_por_que() {
        let ctx = setup().await;
        let used = new_invite(&ctx).await;
        redeem(&ctx, &used, 1, "Fulano").await;
        let expired = invites::create(
            &ctx.db,
            &ctx.owner,
            InviteKind::New,
            None,
            60,
            1,
            now() - 120,
        )
        .await
        .unwrap();

        for uri in [
            "/invite/AAAA-AAAA-AAAA".to_owned(),
            "/invite/isto-nao-e-codigo".to_owned(),
            format!("/invite/{used}"),
            format!("/recovery/{}", expired.code),
        ] {
            let (status, html) = page(&ctx, &uri).await;
            assert_eq!(status, StatusCode::OK, "{uri}");
            assert!(
                html.contains(r#"content="Esse convite não vale mais""#),
                "{uri}"
            );
            assert!(!html.contains("ashtar://"), "{uri}");
            assert!(!html.contains("Kid"), "{uri}");
        }
    }

    #[tokio::test]
    async fn codigo_errado_na_pagina_conta_no_limite() {
        let ctx = setup().await;
        let code = new_invite(&ctx).await;
        for _ in 0..20 {
            page(&ctx, "/invite/AAAA-AAAA-AAAA").await;
        }
        let (status, html) = page(&ctx, &format!("/invite/{code}")).await;
        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
        assert!(html.contains("Muitas tentativas"));
        // O limite é o mesmo do app.
        assert_eq!(
            redeem(&ctx, &code, 1, "Fulano").await.0,
            StatusCode::TOO_MANY_REQUESTS
        );
    }

    #[tokio::test]
    async fn texto_do_banco_sai_escapado() {
        let ctx = setup().await;
        // A validação não deixa um nome assim entrar; o banco aceita, e a página
        // não pode confiar na validação.
        sqlx::query("UPDATE users SET display_name = ? WHERE id = ?")
            .bind(r#"<script>"x"</script>"#)
            .bind(&ctx.owner.id)
            .execute(&ctx.db)
            .await
            .unwrap();
        let code = new_invite(&ctx).await;

        let (_, html) = page(&ctx, &format!("/invite/{code}")).await;
        assert!(!html.contains(r#"<script>"x""#));
        assert!(html.contains("&lt;script&gt;&quot;x&quot;&lt;/script&gt; te convidou"));
    }

    #[tokio::test]
    async fn icone_em_png() {
        let ctx = setup().await;
        let (status, headers, body) = get(&ctx.router, "/invite.png").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(headers[CONTENT_TYPE], "image/png");
        assert!(body.starts_with(b"\x89PNG\r\n\x1a\n"));
        // Largura e altura no cabeçalho IHDR do PNG: 512 × 512.
        assert_eq!(&body[16..24], &[0, 0, 2, 0, 0, 0, 2, 0]);
    }

    #[tokio::test]
    async fn paginas_ficam_fora_da_politica_do_app() {
        let db = db::connect_in_memory().await.unwrap();
        let owner = users::create_owner(&db, "Kid", now()).await.unwrap();
        let policy = ClientPolicy {
            min_version: Some("9.9.9".parse().unwrap()),
        };
        let router = app(
            AppState::new(db.clone(), "https://ashtar.test"),
            Arc::new(policy),
        );
        let code = invites::create(&db, &owner, InviteKind::New, None, DAY, 1, now())
            .await
            .unwrap()
            .code;

        let (status, _, _) = get(&router, &format!("/invite/{code}")).await;
        assert_eq!(status, StatusCode::OK);
        let (status, _, _) = get(&router, "/invite.png").await;
        assert_eq!(status, StatusCode::OK);
        // A API continua exigindo a versão do app.
        let (status, _, _) = get(&router, &format!("/api/invites/{code}")).await;
        assert_eq!(status, StatusCode::UPGRADE_REQUIRED);
    }
}
