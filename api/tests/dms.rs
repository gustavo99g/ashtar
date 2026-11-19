//! Testes de integração das conversas privadas (ADR 0021): abrir, listar, ler e
//! enviar, pelas rotas de verdade, num banco em memória. O que mais importa
//! aqui é o que a terceira pessoa NÃO consegue.

use std::sync::Arc;

use api::client_policy::ClientPolicy;
use api::db::{self, now};
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

/// O dono (Kid) e mais duas pessoas: a Ana conversa com o Kid, e a Bia é a
/// terceira, que não pode saber de nada.
struct Ctx {
    db: SqlitePool,
    router: Router,
    owner: User,
    kid: String,
    ana: String,
    bia: String,
    ana_id: String,
    bia_id: String,
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
        kid: String::new(),
        ana: String::new(),
        bia: String::new(),
        ana_id: String::new(),
        bia_id: String::new(),
    };
    ctx.kid = join(&ctx, "Kid", 1, true).await;
    ctx.ana = join(&ctx, "ana", 2, false).await;
    ctx.bia = join(&ctx, "bia", 3, false).await;
    ctx.ana_id = id_of(&ctx, "ana").await;
    ctx.bia_id = id_of(&ctx, "bia").await;
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

async fn id_of(ctx: &Ctx, nick: &str) -> String {
    users::get_active_by_nick(&ctx.db, nick).await.unwrap().id
}

/// Abre a conversa de quem tem o `token` com `user_id`.
async fn open(ctx: &Ctx, token: &str, user_id: &str) -> (StatusCode, Value) {
    call(
        &ctx.router,
        "POST",
        "/api/dms",
        Some(token),
        Some(json!({ "user_id": user_id })),
    )
    .await
}

async fn send(
    ctx: &Ctx,
    token: &str,
    channel: &str,
    client_id: &str,
    body: &str,
) -> (StatusCode, Value) {
    call(
        &ctx.router,
        "POST",
        &format!("/api/channels/{channel}/messages"),
        Some(token),
        Some(json!({ "client_id": client_id, "body": body })),
    )
    .await
}

async fn read(ctx: &Ctx, token: &str, channel: &str, query: &str) -> (StatusCode, Value) {
    call(
        &ctx.router,
        "GET",
        &format!("/api/channels/{channel}/messages{query}"),
        Some(token),
        None,
    )
    .await
}

/// A conversa do Kid com a Ana, já aberta: devolve o id.
async fn kid_and_ana(ctx: &Ctx) -> String {
    let (status, body) = open(ctx, &ctx.kid, &ctx.ana_id).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["id"].as_str().unwrap().to_owned()
}

#[tokio::test]
async fn abrir_duas_vezes_devolve_a_mesma_conversa_dos_dois_lados() {
    let ctx = setup().await;

    let (status, first) = open(&ctx, &ctx.kid, &ctx.ana_id).await;
    assert_eq!(status, StatusCode::CREATED, "{first}");
    assert_eq!(first["person"]["nick"], "ana");
    assert_eq!(first["person"]["removed"], false);
    assert_eq!(first["last_message"], Value::Null);

    let (status, again) = open(&ctx, &ctx.kid, &ctx.ana_id).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(again["id"], first["id"]);

    // Do outro lado é a mesma conversa, e a "outra pessoa" passa a ser o Kid.
    let (status, other_side) = open(&ctx, &ctx.ana, &ctx.owner.id).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(other_side["id"], first["id"]);
    assert_eq!(other_side["person"]["nick"], "Kid");

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM channels WHERE kind = 'dm'")
        .fetch_one(&ctx.db)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn nao_abre_consigo_mesmo_nem_com_quem_nao_esta_no_grupo() {
    let ctx = setup().await;

    let (status, body) = open(&ctx, &ctx.kid, &ctx.owner.id).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    let (status, body) = open(&ctx, &ctx.kid, "ninguem").await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");

    let bia = users::get_by_id(&ctx.db, &ctx.bia_id).await.unwrap();
    users::remove(&ctx.db, &ctx.owner, &bia, now())
        .await
        .unwrap();
    let (status, body) = open(&ctx, &ctx.kid, &ctx.bia_id).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");

    let (status, _) = call(&ctx.router, "POST", "/api/dms", None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn os_dois_leem_e_escrevem_pelas_rotas_de_mensagem() {
    let ctx = setup().await;
    let dm = kid_and_ana(&ctx).await;

    let (status, sent) = send(&ctx, &ctx.kid, &dm, "c1", "  oi, ana  ").await;
    assert_eq!(status, StatusCode::CREATED, "{sent}");
    assert_eq!(sent["channel_id"], dm.as_str());
    assert_eq!(sent["body"], "oi, ana");
    let (status, _) = send(&ctx, &ctx.ana, &dm, "c1", "oi, kid").await;
    assert_eq!(status, StatusCode::CREATED);

    // O mesmo client_id do mesmo autor não duplica, como nos canais.
    let (status, repeated) = send(&ctx, &ctx.kid, &dm, "c1", "oi, ana").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(repeated["id"], sent["id"]);

    for token in [&ctx.kid, &ctx.ana] {
        let (status, page) = read(&ctx, token, &dm, "").await;
        assert_eq!(status, StatusCode::OK, "{page}");
        let bodies: Vec<&str> = page["messages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["body"].as_str().unwrap())
            .collect();
        assert_eq!(bodies, ["oi, ana", "oi, kid"]);
    }

    // A volta de uma queda (`?after=`) também vale na conversa.
    let after = format!("?after={}", sent["id"].as_str().unwrap());
    let (status, page) = read(&ctx, &ctx.ana, &dm, &after).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(page["messages"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn a_terceira_pessoa_recebe_o_404_de_um_id_que_nao_existe() {
    let ctx = setup().await;
    let dm = kid_and_ana(&ctx).await;
    let (_, sent) = send(&ctx, &ctx.kid, &dm, "c1", "segredo").await;

    let (_, missing) = read(&ctx, &ctx.bia, "nao-existe", "").await;

    let (status, body) = read(&ctx, &ctx.bia, &dm, "").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Igual, letra por letra: a resposta não confirma que a conversa existe.
    assert_eq!(body, missing);

    let after = format!("?after={}", sent["id"].as_str().unwrap());
    let (status, body) = read(&ctx, &ctx.bia, &dm, &after).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, missing);
    let (status, _) = read(&ctx, &ctx.bia, &dm, "?before=zzz").await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, body) = send(&ctx, &ctx.bia, &dm, "b1", "oi?").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, missing);
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE channel_id = ?")
        .bind(&dm)
        .fetch_one(&ctx.db)
        .await
        .unwrap();
    assert_eq!(count, 1, "a mensagem da terceira pessoa não foi gravada");

    // E a lista de conversas dela continua vazia.
    let (status, list) = call(&ctx.router, "GET", "/api/dms", Some(&ctx.bia), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list, json!([]));
}

#[tokio::test]
async fn a_lista_so_tem_conversa_com_mensagem_na_ordem_da_ultima() {
    let ctx = setup().await;
    let with_ana = kid_and_ana(&ctx).await;
    let (_, with_bia) = open(&ctx, &ctx.kid, &ctx.bia_id).await;
    let with_bia = with_bia["id"].as_str().unwrap().to_owned();

    // Abrir e não escrever não aparece para ninguém.
    for token in [&ctx.kid, &ctx.ana, &ctx.bia] {
        let (_, list) = call(&ctx.router, "GET", "/api/dms", Some(token), None).await;
        assert_eq!(list, json!([]));
    }

    send(&ctx, &ctx.kid, &with_ana, "c1", "oi, ana").await;
    send(&ctx, &ctx.bia, &with_bia, "c1", "oi, kid").await;

    let (_, list) = call(&ctx.router, "GET", "/api/dms", Some(&ctx.kid), None).await;
    let list = list.as_array().unwrap();
    assert_eq!(list.len(), 2);
    // A da Bia andou por último.
    assert_eq!(list[0]["id"], with_bia.as_str());
    assert_eq!(list[0]["person"]["nick"], "bia");
    assert_eq!(list[0]["last_message"]["body"], "oi, kid");
    assert_eq!(list[1]["id"], with_ana.as_str());

    // A Ana só vê a dela.
    let (_, list) = call(&ctx.router, "GET", "/api/dms", Some(&ctx.ana), None).await;
    let list = list.as_array().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0]["person"]["nick"], "Kid");
}

#[tokio::test]
async fn a_conversa_nunca_entra_na_lista_de_canais() {
    let ctx = setup().await;
    let dm = kid_and_ana(&ctx).await;
    send(&ctx, &ctx.kid, &dm, "c1", "oi").await;

    let (status, layout) = call(&ctx.router, "GET", "/api/channels", Some(&ctx.kid), None).await;
    assert_eq!(status, StatusCode::OK, "{layout}");
    assert!(!layout.to_string().contains(&dm), "{layout}");

    let (status, archived) = call(
        &ctx.router,
        "GET",
        "/api/channels/archived",
        Some(&ctx.kid),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{archived}");
    assert!(!archived.to_string().contains(&dm));

    // Editar e arquivar pelo id: o 404 de um canal que não existe.
    let (status, _) = call(
        &ctx.router,
        "PATCH",
        &format!("/api/channels/{dm}"),
        Some(&ctx.kid),
        Some(json!({ "name": "vazou" })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = call(
        &ctx.router,
        "POST",
        &format!("/api/channels/{dm}/archive"),
        Some(&ctx.kid),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Reordenar continua valendo com a lista de sempre: a conversa não é um
    // canal "que faltou" no pedido, e mandar o id dela é recusado.
    let version = layout["version"].as_i64().unwrap();
    let same = json!({
        "version": version,
        "top": [],
        "categories": [
            { "id": "texto", "channels": ["geral"] },
            { "id": "voz", "channels": ["sala"] },
        ],
    });
    let (status, body) = call(
        &ctx.router,
        "PUT",
        "/api/channels/layout",
        Some(&ctx.kid),
        Some(same),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let with_dm = json!({
        "version": version + 1,
        "top": [dm],
        "categories": [
            { "id": "texto", "channels": ["geral"] },
            { "id": "voz", "channels": ["sala"] },
        ],
    });
    let (status, _) = call(
        &ctx.router,
        "PUT",
        "/api/channels/layout",
        Some(&ctx.kid),
        Some(with_dm),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // A sala de voz também não vira lugar de mensagem por causa da regra nova.
    let (status, _) = read(&ctx, &ctx.kid, "sala", "").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn com_quem_saiu_do_grupo_a_conversa_fica_so_para_leitura() {
    let ctx = setup().await;
    let dm = kid_and_ana(&ctx).await;
    send(&ctx, &ctx.ana, &dm, "c1", "tchau").await;

    let ana = users::get_by_id(&ctx.db, &ctx.ana_id).await.unwrap();
    users::remove(&ctx.db, &ctx.owner, &ana, now())
        .await
        .unwrap();

    let (status, page) = read(&ctx, &ctx.kid, &dm, "").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(page["messages"][0]["body"], "tchau");

    let (status, body) = send(&ctx, &ctx.kid, &dm, "c2", "volta!").await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["message"], "Essa pessoa saiu do grupo.");

    let (_, list) = call(&ctx.router, "GET", "/api/dms", Some(&ctx.kid), None).await;
    assert_eq!(list[0]["person"]["removed"], true);
}

#[tokio::test]
async fn o_limite_de_envio_conta_junto_com_os_canais() {
    let ctx = setup().await;
    let dm = kid_and_ana(&ctx).await;

    for i in 0..3 {
        let (status, _) = send(&ctx, &ctx.kid, "geral", &format!("g{i}"), "oi").await;
        assert_eq!(status, StatusCode::CREATED);
    }
    for i in 0..2 {
        let (status, _) = send(&ctx, &ctx.kid, &dm, &format!("d{i}"), "oi").await;
        assert_eq!(status, StatusCode::CREATED);
    }
    let (status, _) = send(&ctx, &ctx.kid, &dm, "d9", "demais").await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
}

/// A migração 0004 refaz a `channels`, e as mensagens apontam para ela. Roda as
/// três primeiras à mão, põe dados, roda a 0004 e confere que nada se perdeu.
#[tokio::test]
async fn a_migracao_refaz_a_channels_sem_perder_canal_nem_mensagem() {
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::str::FromStr;

    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .unwrap()
        .foreign_keys(true);
    let db = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    for sql in [
        include_str!("../migrations/0001_identidade.sql"),
        include_str!("../migrations/0002_chat.sql"),
        include_str!("../migrations/0003_channel_layout.sql"),
    ] {
        sqlx::raw_sql(sql).execute(&db).await.unwrap();
    }
    sqlx::raw_sql(
        "INSERT INTO users (id, nick, is_owner, created_at)
         VALUES ('u1', 'Kid', 1, 1);
         INSERT INTO channels (id, kind, name, category_id, position, created_at, archived_at)
         VALUES ('velho', 'text', 'velho', NULL, 0, 1, 99);
         INSERT INTO messages (id, channel_id, author_id, client_id, body, created_at)
         VALUES ('m1', 'geral', 'u1', 'c1', 'oi', 1),
                ('m2', 'geral', 'u1', 'c2', 'de novo', 2),
                ('m3', 'velho', 'u1', 'c3', 'arquivada', 3);",
    )
    .execute(&db)
    .await
    .unwrap();
    let before: Vec<(String, String, Option<String>, Option<i64>)> =
        sqlx::query_as("SELECT id, kind, name, archived_at FROM channels ORDER BY id")
            .fetch_all(&db)
            .await
            .unwrap();

    // Numa transação, como o `sqlx::migrate!` roda cada migração.
    let mut tx = db.begin().await.unwrap();
    sqlx::raw_sql(include_str!("../migrations/0004_conversas_privadas.sql"))
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let after: Vec<(String, String, Option<String>, Option<i64>)> =
        sqlx::query_as("SELECT id, kind, name, archived_at FROM channels ORDER BY id")
            .fetch_all(&db)
            .await
            .unwrap();
    assert_eq!(after, before);
    let messages: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(messages, 3);
    let broken: Vec<(String,)> = sqlx::query_as("SELECT \"table\" FROM pragma_foreign_key_check")
        .fetch_all(&db)
        .await
        .unwrap();
    assert!(broken.is_empty(), "{broken:?}");

    // As chaves continuam valendo: mensagem para um canal que não existe não entra.
    let orphan = sqlx::query(
        "INSERT INTO messages (id, channel_id, author_id, client_id, body, created_at)
         VALUES ('m9', 'nao-existe', 'u1', 'c9', 'x', 9)",
    )
    .execute(&db)
    .await;
    assert!(orphan.is_err());
    // E as regras novas da tabela: `dm` sem chave, ou canal sem nome, não entram.
    for bad in [
        "INSERT INTO channels (id, kind, created_at) VALUES ('d1', 'dm', 1)",
        "INSERT INTO channels (id, kind, created_at, dm_key, name) VALUES ('d2', 'dm', 1, 'a:b', 'x')",
        "INSERT INTO channels (id, kind, position, created_at) VALUES ('t1', 'text', 0, 1)",
    ] {
        assert!(sqlx::query(bad).execute(&db).await.is_err(), "{bad}");
    }
}
