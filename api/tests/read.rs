//! Testes de integração de lidas, menções e silenciar (ADR 0022), pelas rotas
//! de verdade, num banco em memória.

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

/// O dono (Kid) e mais duas pessoas, a Ana e a Bia.
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

/// O id da mensagem que `token` acabou de mandar em `channel`.
async fn say(ctx: &Ctx, token: &str, channel: &str, body: &str) -> String {
    let client_id = uuid::Uuid::new_v4().to_string();
    let (status, sent) = send(ctx, token, channel, &client_id, body).await;
    assert_eq!(status, StatusCode::CREATED, "{sent}");
    sent["id"].as_str().unwrap().to_owned()
}

async fn mark_read(ctx: &Ctx, token: &str, channel: &str, message_id: &str) -> (StatusCode, Value) {
    call(
        &ctx.router,
        "PUT",
        &format!("/api/channels/{channel}/read"),
        Some(token),
        Some(json!({ "message_id": message_id })),
    )
    .await
}

async fn mute(ctx: &Ctx, token: &str, channel: &str, muted: bool) -> (StatusCode, Value) {
    call(
        &ctx.router,
        "PUT",
        &format!("/api/channels/{channel}/mute"),
        Some(token),
        Some(json!({ "muted": muted })),
    )
    .await
}

/// O estado de `user_id` em `channel`, como o `ready` levaria.
async fn state(ctx: &Ctx, user_id: &str, channel: &str) -> Value {
    serde_json::to_value(
        api::chat::read::state(&ctx.db, user_id, channel)
            .await
            .unwrap(),
    )
    .unwrap()
}

fn expect(last_read_id: Option<&str>, unread: u32, mentions: u32, muted: bool) -> Value {
    json!({ "last_read_id": last_read_id, "unread": unread, "mentions": mentions, "muted": muted })
}

/// A conversa do Kid com a Ana, já aberta: devolve o id.
async fn kid_and_ana(ctx: &Ctx) -> String {
    let (status, body) = open(ctx, &ctx.kid, &ctx.ana_id).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["id"].as_str().unwrap().to_owned()
}

#[tokio::test]
async fn as_mensagens_dos_outros_contam_e_as_minhas_nao() {
    let ctx = setup().await;
    let first = say(&ctx, &ctx.kid, "geral", "um").await;
    say(&ctx, &ctx.kid, "geral", "dois").await;
    let last = say(&ctx, &ctx.kid, "geral", "três").await;

    // Para a Ana, três não lidas; para o Kid, que escreveu, nenhuma.
    assert_eq!(state(&ctx, &ctx.ana_id, "geral").await["unread"], 3);
    assert_eq!(
        state(&ctx, &ctx.owner.id, "geral").await,
        expect(Some(&last), 0, 0, false)
    );

    // A Ana lê a primeira: sobram duas. A resposta já traz o estado novo.
    let (status, body) = mark_read(&ctx, &ctx.ana, "geral", &first).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body, expect(Some(&first), 2, 0, false));

    // Ela responde: escrever é ter lido até ali, e a dela não conta para ela.
    let hers = say(&ctx, &ctx.ana, "geral", "oi").await;
    assert_eq!(
        state(&ctx, &ctx.ana_id, "geral").await,
        expect(Some(&hers), 0, 0, false)
    );
    assert_eq!(state(&ctx, &ctx.owner.id, "geral").await["unread"], 1);
}

#[tokio::test]
async fn o_ponteiro_nao_volta() {
    let ctx = setup().await;
    let first = say(&ctx, &ctx.kid, "geral", "um").await;
    let second = say(&ctx, &ctx.kid, "geral", "dois").await;

    let (_, body) = mark_read(&ctx, &ctx.ana, "geral", &second).await;
    assert_eq!(body, expect(Some(&second), 0, 0, false));
    let (status, body) = mark_read(&ctx, &ctx.ana, "geral", &first).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        expect(Some(&second), 0, 0, false),
        "continua na segunda"
    );
}

#[tokio::test]
async fn marcar_como_lido_pede_uma_mensagem_do_canal_e_um_canal_que_se_le() {
    let ctx = setup().await;
    let dm = kid_and_ana(&ctx).await;
    let in_dm = say(&ctx, &ctx.kid, &dm, "segredo").await;
    let in_geral = say(&ctx, &ctx.kid, "geral", "oi").await;

    // Mensagem de outro canal, ou que não existe: 422.
    for message_id in [in_dm.as_str(), "nao-existe"] {
        let (status, body) = mark_read(&ctx, &ctx.ana, "geral", message_id).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    }
    // A Bia não lê a conversa: não marca nem silencia, e recebe o 404 de um
    // canal que não existe.
    let (status, missing) = mark_read(&ctx, &ctx.bia, "nao-existe", &in_geral).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, body) = mark_read(&ctx, &ctx.bia, &dm, &in_dm).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, missing);
    let (status, body) = mute(&ctx, &ctx.bia, &dm, true).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, missing);
    let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM channel_state WHERE user_id = ?")
        .bind(&ctx.bia_id)
        .fetch_one(&ctx.db)
        .await
        .unwrap();
    // Só o ponteiro do #geral, que ela ganhou ao entrar.
    assert_eq!(rows, 1);
}

#[tokio::test]
async fn a_mencao_conta_mesmo_com_o_canal_silenciado() {
    let ctx = setup().await;
    let (status, body) = mute(&ctx, &ctx.ana, "geral", true).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["muted"], true);

    let (_, sent) = send(&ctx, &ctx.kid, "geral", "c1", "olha isso, @ANA e @bia").await;
    let mut mentioned = vec![ctx.ana_id.clone(), ctx.bia_id.clone()];
    mentioned.sort();
    assert_eq!(sent["mentions"], json!(mentioned));
    say(&ctx, &ctx.kid, "geral", "sem menção").await;

    let ana = state(&ctx, &ctx.ana_id, "geral").await;
    assert_eq!(ana["muted"], true);
    assert_eq!(ana["unread"], 2);
    assert_eq!(ana["mentions"], 1);

    // O histórico traz as menções de cada mensagem.
    let (_, page) = call(
        &ctx.router,
        "GET",
        "/api/channels/geral/messages",
        Some(&ctx.ana),
        None,
    )
    .await;
    assert_eq!(page["messages"][0]["mentions"], json!(mentioned));
    assert_eq!(page["messages"][1]["mentions"], json!([]));

    // Ler zera as duas contagens; o silenciar fica.
    let (_, body) = mark_read(&ctx, &ctx.ana, "geral", sent["id"].as_str().unwrap()).await;
    assert_eq!(body["mentions"], 0);
    assert_eq!(body["unread"], 1);
    assert_eq!(body["muted"], true);
    let (_, body) = mute(&ctx, &ctx.ana, "geral", false).await;
    assert_eq!(body["muted"], false);
    assert_eq!(body["unread"], 1, "voltar a ouvir não mexe no ponteiro");
}

#[tokio::test]
async fn o_que_nao_e_mencao() {
    let ctx = setup().await;
    for body in [
        "escreve para fulano@ana.com",
        "veja https://site.com/@ana",
        "@anabela não é a ana",
        "eu, @Kid, falando de mim",
        "@todos",
    ] {
        let client_id = uuid::Uuid::new_v4().to_string();
        let (status, sent) = send(&ctx, &ctx.kid, "geral", &client_id, body).await;
        assert_eq!(status, StatusCode::CREATED, "{sent}");
        assert_eq!(sent["mentions"], json!([]), "{body}");
    }
    assert_eq!(state(&ctx, &ctx.ana_id, "geral").await["mentions"], 0);
    let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mentions")
        .fetch_one(&ctx.db)
        .await
        .unwrap();
    assert_eq!(rows, 0);
}

#[tokio::test]
async fn mencionar_um_terceiro_numa_conversa_privada_nao_grava_nada() {
    let ctx = setup().await;
    let dm = kid_and_ana(&ctx).await;

    let (_, sent) = send(&ctx, &ctx.kid, &dm, "c1", "a @bia não pode saber, @ana").await;
    assert_eq!(sent["mentions"], json!([ctx.ana_id]));
    let rows: Vec<(String,)> = sqlx::query_as("SELECT user_id FROM mentions")
        .fetch_all(&ctx.db)
        .await
        .unwrap();
    assert_eq!(rows, [(ctx.ana_id.clone(),)]);

    // A lista de conversas traz o estado de quem pede.
    let (_, list) = call(&ctx.router, "GET", "/api/dms", Some(&ctx.ana), None).await;
    assert_eq!(list[0]["state"], expect(None, 1, 1, false));
    let (_, list) = call(&ctx.router, "GET", "/api/dms", Some(&ctx.kid), None).await;
    assert_eq!(list[0]["state"], expect(sent["id"].as_str(), 0, 0, false));
}

#[tokio::test]
async fn quem_saiu_do_grupo_nao_e_mencionado() {
    let ctx = setup().await;
    let (status, _) = call(
        &ctx.router,
        "DELETE",
        &format!("/api/members/{}", ctx.bia_id),
        Some(&ctx.kid),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, sent) = send(&ctx, &ctx.kid, "geral", "c1", "cadê a @bia?").await;
    assert_eq!(sent["mentions"], json!([]));
}

#[tokio::test]
async fn marcar_tudo_como_lido_zera_canais_e_conversas() {
    let ctx = setup().await;
    let dm = kid_and_ana(&ctx).await;
    let (status, created) = call(
        &ctx.router,
        "POST",
        "/api/channels",
        Some(&ctx.kid),
        Some(json!({ "name": "jogos" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let jogos = created["id"].as_str().unwrap().to_owned();

    say(&ctx, &ctx.kid, "geral", "oi @ana").await;
    say(&ctx, &ctx.kid, &jogos, "partida hoje").await;
    let in_dm = say(&ctx, &ctx.kid, &dm, "e aí").await;
    // A conversa da Bia com o Kid não é da Ana: tem de continuar não lida.
    let (_, other) = open(&ctx, &ctx.kid, &ctx.bia_id).await;
    let other = other["id"].as_str().unwrap().to_owned();
    say(&ctx, &ctx.kid, &other, "só para a bia").await;

    for channel in ["geral", jogos.as_str(), dm.as_str()] {
        assert_eq!(state(&ctx, &ctx.ana_id, channel).await["unread"], 1);
    }
    let (status, _) = call(&ctx.router, "POST", "/api/read-all", Some(&ctx.ana), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    for channel in ["geral", jogos.as_str()] {
        let now = state(&ctx, &ctx.ana_id, channel).await;
        assert_eq!((&now["unread"], &now["mentions"]), (&json!(0), &json!(0)));
    }
    assert_eq!(
        state(&ctx, &ctx.ana_id, &dm).await,
        expect(Some(&in_dm), 0, 0, false)
    );
    assert_eq!(state(&ctx, &ctx.bia_id, &other).await["unread"], 1);
    let leaked: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM channel_state WHERE user_id = ? AND channel_id = ?",
    )
    .bind(&ctx.ana_id)
    .bind(&other)
    .fetch_one(&ctx.db)
    .await
    .unwrap();
    assert_eq!(leaked, 0, "a Ana não ganha ponteiro na conversa dos outros");

    // De novo, sem nada novo: não muda nada.
    let (status, _) = call(&ctx.router, "POST", "/api/read-all", Some(&ctx.ana), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn a_contagem_para_em_cem() {
    let ctx = setup().await;
    let channel = api::chat::access::Readable::Text(
        api::chat::channels::get_open_text(&ctx.db, "geral")
            .await
            .unwrap(),
    );
    let limiter = api::limiter::SendLimiter::new(usize::MAX, std::time::Duration::from_secs(1));
    for i in 0..105 {
        api::chat::messages::create(
            &ctx.db,
            &limiter,
            &channel,
            &ctx.owner,
            &format!("c{i}"),
            "oi @ana",
            None,
            now(),
        )
        .await
        .unwrap();
    }
    let ana = state(&ctx, &ctx.ana_id, "geral").await;
    assert_eq!(ana["unread"], 100);
    assert_eq!(ana["mentions"], 100);
}

#[tokio::test]
async fn quem_entra_depois_ve_o_historico_sem_numeros() {
    let ctx = setup().await;
    let last = say(&ctx, &ctx.kid, "geral", "antes da Clara").await;

    let clara = join(&ctx, "clara", 4, false).await;
    let clara_id = id_of(&ctx, "clara").await;
    assert_eq!(
        state(&ctx, &clara_id, "geral").await,
        expect(Some(&last), 0, 0, false)
    );
    // O que chega depois conta.
    say(&ctx, &ctx.kid, "geral", "bem-vinda").await;
    assert_eq!(state(&ctx, &clara_id, "geral").await["unread"], 1);
    // E ela lê o histórico normalmente.
    let (status, page) = call(
        &ctx.router,
        "GET",
        "/api/channels/geral/messages",
        Some(&clara),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(page["messages"].as_array().unwrap().len(), 2);
}

/// A migração 0005 em cima de um banco com histórico: todo membro ativo fica
/// com zero não lidas em todo canal de texto.
#[tokio::test]
async fn a_migracao_deixa_todo_mundo_com_zero_nao_lidas() {
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
        include_str!("../migrations/0004_conversas_privadas.sql"),
    ] {
        let mut tx = db.begin().await.unwrap();
        sqlx::raw_sql(sql).execute(&mut *tx).await.unwrap();
        tx.commit().await.unwrap();
    }
    sqlx::raw_sql(
        "INSERT INTO users (id, nick, is_owner, created_at, removed_at)
         VALUES ('u1', 'Kid', 1, 1, NULL), ('u2', 'ana', 0, 1, NULL), ('u3', 'saiu', 0, 1, 5);
         INSERT INTO channels (id, kind, name, category_id, position, created_at, archived_at)
         VALUES ('vazio', 'text', 'vazio', NULL, 1, 1, NULL),
                ('velho', 'text', 'velho', NULL, 0, 1, 99);
         INSERT INTO channels (id, kind, created_at, dm_key) VALUES ('d1', 'dm', 1, 'u1:u2');
         INSERT INTO channel_members (channel_id, user_id) VALUES ('d1', 'u1'), ('d1', 'u2');
         INSERT INTO messages (id, channel_id, author_id, client_id, body, created_at)
         VALUES ('m1', 'geral', 'u1', 'c1', 'oi', 1),
                ('m2', 'geral', 'u2', 'c2', 'oi', 2),
                ('m3', 'velho', 'u1', 'c3', 'arquivada', 3),
                ('m4', 'd1', 'u1', 'c4', 'privada', 4);",
    )
    .execute(&db)
    .await
    .unwrap();

    let mut tx = db.begin().await.unwrap();
    sqlx::raw_sql(include_str!("../migrations/0005_lidas_e_mencoes.sql"))
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let pointers: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT user_id, channel_id, last_read_id FROM channel_state ORDER BY user_id, channel_id",
    )
    .fetch_all(&db)
    .await
    .unwrap();
    let row = |user: &str, channel: &str, last: Option<&str>| {
        (user.to_owned(), channel.to_owned(), last.map(str::to_owned))
    };
    // Os dois ativos, nos três canais de texto (o arquivado também); quem saiu
    // e a conversa privada ficam de fora.
    assert_eq!(
        pointers,
        [
            row("u1", "geral", Some("m2")),
            row("u1", "vazio", None),
            row("u1", "velho", Some("m3")),
            row("u2", "geral", Some("m2")),
            row("u2", "vazio", None),
            row("u2", "velho", Some("m3")),
        ]
    );
    // As consultas de hoje precisam das migrações seguintes (o tipo da
    // mensagem é da 0007, e o canal restrito, da 0008).
    for sql in [
        include_str!("../migrations/0006_status.sql"),
        include_str!("../migrations/0007_ligacoes.sql"),
        include_str!("../migrations/0008_canais_restritos.sql"),
    ] {
        let mut tx = db.begin().await.unwrap();
        sqlx::raw_sql(sql).execute(&mut *tx).await.unwrap();
        tx.commit().await.unwrap();
    }
    for user in ["u1", "u2"] {
        for head in api::chat::read::heads(&db, user).await.unwrap() {
            assert_eq!(head.state.unread, 0, "{user} em {}", head.channel_id);
        }
    }
    // A mensagem privada que ninguém viu é não lida de verdade.
    let dm = api::chat::read::state(&db, "u2", "d1").await.unwrap();
    assert_eq!(dm.unread, 1);
}
