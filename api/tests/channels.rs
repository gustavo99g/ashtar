//! Testes de integração dos canais e categorias: a lista, gerenciar, arquivar
//! e reordenar, pelas rotas de verdade, num banco em memória.

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

async fn layout(ctx: &Ctx, token: &str) -> Value {
    let (status, body) = call(&ctx.router, "GET", "/api/channels", Some(token), None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

/// A lista como texto curto: `topo[..] Texto[geral] Voz[Sala]`, pelos nomes.
fn shape(layout: &Value) -> String {
    let names = |list: &Value| -> String {
        list.as_array()
            .unwrap()
            .iter()
            .map(|c| c["name"].as_str().unwrap().to_owned())
            .collect::<Vec<_>>()
            .join(",")
    };
    let mut parts = vec![format!("topo[{}]", names(&layout["top"]))];
    for category in layout["categories"].as_array().unwrap() {
        parts.push(format!(
            "{}[{}]",
            category["name"].as_str().unwrap(),
            names(&category["channels"])
        ));
    }
    parts.join(" ")
}

async fn create_channel(ctx: &Ctx, token: &str, body: Value) -> (StatusCode, Value) {
    call(
        &ctx.router,
        "POST",
        "/api/channels",
        Some(token),
        Some(body),
    )
    .await
}

async fn member_id(ctx: &Ctx, token: &str) -> String {
    let (_, me) = call(&ctx.router, "GET", "/api/me", Some(token), None).await;
    me["user"]["id"].as_str().unwrap().to_owned()
}

/// O pedido de reordenar a partir de uma lista lida (ids na mesma ordem).
fn order_of(layout: &Value) -> Value {
    let ids = |list: &Value| -> Vec<Value> {
        list.as_array()
            .unwrap()
            .iter()
            .map(|c| c["id"].clone())
            .collect()
    };
    json!({
        "version": layout["version"],
        "top": ids(&layout["top"]),
        "categories": layout["categories"].as_array().unwrap().iter().map(|c| json!({
            "id": c["id"],
            "channels": ids(&c["channels"]),
        })).collect::<Vec<_>>(),
    })
}

#[tokio::test]
async fn a_lista_comeca_com_o_geral_e_a_sala() {
    let ctx = setup().await;
    let ana = join(&ctx, "Ana", 2, false).await;
    let list = layout(&ctx, &ana).await;
    assert_eq!(list["version"], 1);
    assert_eq!(shape(&list), "topo[] Texto[geral] Voz[Sala]");
    assert_eq!(list["categories"][1]["channels"][0]["id"], "sala");
    assert_eq!(list["categories"][1]["channels"][0]["kind"], "voice");
    assert_eq!(
        list["categories"][0]["channels"][0]["topic"],
        "Conversa geral do grupo"
    );
}

#[tokio::test]
async fn so_quem_gerencia_mexe_nos_canais() {
    let ctx = setup().await;
    let ana = join(&ctx, "Ana", 2, false).await;
    let ana_id = member_id(&ctx, &ana).await;

    let (status, _) = create_channel(&ctx, &ana, json!({ "name": "jogos" })).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = call(
        &ctx.router,
        "GET",
        "/api/channels/archived",
        Some(&ana),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (_, me) = call(&ctx.router, "GET", "/api/me", Some(&ana), None).await;
    assert_eq!(me["can_manage_channels"], false);

    // O dono liga "Gerenciar canais" pela rota genérica.
    let uri = format!("/api/members/{ana_id}/permissions/canais.gerenciar");
    let (status, _) = call(
        &ctx.router,
        "PUT",
        &uri,
        Some(&ctx.owner_token),
        Some(json!({ "enabled": true })),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (_, me) = call(&ctx.router, "GET", "/api/me", Some(&ana), None).await;
    assert_eq!(me["can_manage_channels"], true);
    assert!(
        me["permissions"]
            .as_array()
            .unwrap()
            .contains(&json!("canais.gerenciar"))
    );
    let (status, _) = create_channel(&ctx, &ana, json!({ "name": "jogos" })).await;
    assert_eq!(status, StatusCode::CREATED);

    // A gaveta do Painel já mostra a permissão nova.
    let uri = format!("/api/members/{ana_id}/permissions");
    let (_, grants) = call(&ctx.router, "GET", &uri, Some(&ctx.owner_token), None).await;
    let row = grants
        .as_array()
        .unwrap()
        .iter()
        .find(|g| g["key"] == "canais.gerenciar")
        .unwrap();
    assert_eq!(row["label"], "Gerenciar canais");
    assert_eq!(row["granted"], true);

    // Chave que não existe, e quem não é dono ligando: 404 e 403.
    let uri = format!("/api/members/{ana_id}/permissions/nao.existe");
    let enabled = Some(json!({ "enabled": true }));
    let (status, _) = call(
        &ctx.router,
        "PUT",
        &uri,
        Some(&ctx.owner_token),
        enabled.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let uri = format!("/api/members/{ana_id}/permissions/atualizacoes.beta");
    let (status, _) = call(&ctx.router, "PUT", &uri, Some(&ana), enabled).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn criar_e_editar_canal() {
    let ctx = setup().await;
    let owner = &ctx.owner_token;
    let (status, created) = create_channel(
        &ctx,
        owner,
        json!({ "name": "  Jogos  Online ", "category_id": "texto", "topic": " Só jogos " }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["name"], "jogos-online");
    assert_eq!(created["topic"], "Só jogos");
    assert_eq!(created["kind"], "text");
    let list = layout(&ctx, owner).await;
    assert_eq!(shape(&list), "topo[] Texto[geral,jogos-online] Voz[Sala]");
    assert_eq!(list["version"], 2);

    // Sem categoria vai para o topo; categoria arquivada ou inventada, 404.
    let (_, solto) = create_channel(&ctx, owner, json!({ "name": "avisos" })).await;
    assert_eq!(solto["category_id"], Value::Null);
    let (status, _) = create_channel(
        &ctx,
        owner,
        json!({ "name": "x", "category_id": "nao-existe" }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = create_channel(&ctx, owner, json!({ "name": "com!" })).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Tópico: troca, e texto vazio tira. O nome da sala de voz é livre.
    let uri = format!("/api/channels/{}", created["id"].as_str().unwrap());
    let (_, edited) = call(
        &ctx.router,
        "PATCH",
        &uri,
        Some(owner),
        Some(json!({ "topic": "" })),
    )
    .await;
    assert_eq!(edited["topic"], Value::Null);
    assert_eq!(edited["name"], "jogos-online");
    let (_, sala) = call(
        &ctx.router,
        "PATCH",
        "/api/channels/sala",
        Some(owner),
        Some(json!({ "name": "Sala do Grupo" })),
    )
    .await;
    assert_eq!(sala["name"], "Sala do Grupo");
    assert_eq!(sala["id"], "sala");
}

#[tokio::test]
async fn arquivar_e_desarquivar_canal() {
    let ctx = setup().await;
    let owner = &ctx.owner_token;
    let (_, jogos) = create_channel(
        &ctx,
        owner,
        json!({ "name": "jogos", "category_id": "texto" }),
    )
    .await;
    let id = jogos["id"].as_str().unwrap();

    for protected in ["geral", "sala"] {
        let uri = format!("/api/channels/{protected}/archive");
        let (status, _) = call(&ctx.router, "POST", &uri, Some(owner), None).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{protected}");
    }

    let (status, _) = call(
        &ctx.router,
        "POST",
        &format!("/api/channels/{id}/archive"),
        Some(owner),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        shape(&layout(&ctx, owner).await),
        "topo[] Texto[geral] Voz[Sala]"
    );
    let (_, archived) = call(
        &ctx.router,
        "GET",
        "/api/channels/archived",
        Some(owner),
        None,
    )
    .await;
    assert_eq!(archived["channels"][0]["id"], id);
    assert!(archived["channels"][0]["archived_at"].is_i64());

    // Arquivado não lê nem recebe mensagem; editar pede para desarquivar.
    let uri = format!("/api/channels/{id}/messages");
    let (status, _) = call(&ctx.router, "GET", &uri, Some(owner), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = call(
        &ctx.router,
        "PATCH",
        &format!("/api/channels/{id}"),
        Some(owner),
        Some(json!({ "topic": "x" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, _) = call(
        &ctx.router,
        "POST",
        &format!("/api/channels/{id}/unarchive"),
        Some(owner),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        shape(&layout(&ctx, owner).await),
        "topo[] Texto[geral,jogos] Voz[Sala]"
    );
}

#[tokio::test]
async fn arquivar_categoria_leva_os_canais_para_o_topo() {
    let ctx = setup().await;
    let owner = &ctx.owner_token;
    let (status, _) = create_channel(&ctx, owner, json!({ "name": "avisos" })).await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, _) = call(
        &ctx.router,
        "POST",
        "/api/categories/texto/archive",
        Some(owner),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        shape(&layout(&ctx, owner).await),
        "topo[avisos,geral] Voz[Sala]"
    );
    let (_, archived) = call(
        &ctx.router,
        "GET",
        "/api/channels/archived",
        Some(owner),
        None,
    )
    .await;
    assert_eq!(archived["categories"][0]["name"], "Texto");

    let (status, _) = call(
        &ctx.router,
        "POST",
        "/api/categories/texto/unarchive",
        Some(owner),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        shape(&layout(&ctx, owner).await),
        "topo[avisos,geral] Voz[Sala] Texto[]"
    );

    // Categoria nova e renomear.
    let (status, list) = call(
        &ctx.router,
        "POST",
        "/api/categories",
        Some(owner),
        Some(json!({ "name": "Jogos" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(shape(&list), "topo[avisos,geral] Voz[Sala] Texto[] Jogos[]");
    let (status, _) = call(
        &ctx.router,
        "PATCH",
        "/api/categories/voz",
        Some(owner),
        Some(json!({ "name": "Voz e vídeo" })),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        shape(&layout(&ctx, owner).await),
        "topo[avisos,geral] Voz e vídeo[Sala] Texto[] Jogos[]"
    );
}

#[tokio::test]
async fn reordenar_confere_a_versao_e_a_lista() {
    let ctx = setup().await;
    let owner = &ctx.owner_token;
    create_channel(
        &ctx,
        owner,
        json!({ "name": "jogos", "category_id": "texto" }),
    )
    .await;
    let list = layout(&ctx, owner).await;

    // A Voz vem primeiro, e o jogos sobe para o topo.
    let mut order = order_of(&list);
    let jogos = order["categories"][0]["channels"][1].clone();
    order["top"] = json!([jogos]);
    order["categories"][0]["channels"] = json!(["geral"]);
    let texto = order["categories"][0].clone();
    order["categories"][0] = order["categories"][1].clone();
    order["categories"][1] = texto;
    let (status, applied) = call(
        &ctx.router,
        "PUT",
        "/api/channels/layout",
        Some(owner),
        Some(order.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{applied}");
    assert_eq!(shape(&applied), "topo[jogos] Voz[Sala] Texto[geral]");
    assert_eq!(applied["version"], list["version"].as_i64().unwrap() + 1);

    // A mesma versão de novo: alguém já mudou (foi este mesmo pedido).
    let (status, body) = call(
        &ctx.router,
        "PUT",
        "/api/channels/layout",
        Some(owner),
        Some(order),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["kind"], "conflict");

    // Faltando um canal, ou com um repetido: 422.
    let mut missing = order_of(&applied);
    missing["top"] = json!([]);
    let (status, _) = call(
        &ctx.router,
        "PUT",
        "/api/channels/layout",
        Some(owner),
        Some(missing),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let mut repeated = order_of(&applied);
    repeated["top"] = json!([jogos, "geral"]);
    let (status, _) = call(
        &ctx.router,
        "PUT",
        "/api/channels/layout",
        Some(owner),
        Some(repeated),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        shape(&layout(&ctx, owner).await),
        "topo[jogos] Voz[Sala] Texto[geral]"
    );
}

#[tokio::test]
async fn editar_sem_mudar_nada_nao_soma_versao() {
    let ctx = setup().await;
    let owner = &ctx.owner_token;
    let before = layout(&ctx, owner).await["version"].as_i64().unwrap();

    // Pedido vazio, o mesmo nome e o mesmo tópico: 200 com o canal, sem versão nova.
    for body in [
        json!({}),
        json!({ "name": "geral" }),
        json!({ "name": "  Geral " }),
        json!({ "topic": "Conversa geral do grupo" }),
    ] {
        let (status, channel) = call(
            &ctx.router,
            "PATCH",
            "/api/channels/geral",
            Some(owner),
            Some(body.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(channel["name"], "geral", "{body}");
    }
    let (status, _) = call(
        &ctx.router,
        "PATCH",
        "/api/categories/voz",
        Some(owner),
        Some(json!({ "name": "Voz" })),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(layout(&ctx, owner).await["version"], before);

    // Mudar de verdade soma.
    call(
        &ctx.router,
        "PATCH",
        "/api/channels/geral",
        Some(owner),
        Some(json!({ "topic": "Outro tópico" })),
    )
    .await;
    assert_eq!(layout(&ctx, owner).await["version"], before + 1);
}

#[tokio::test]
async fn a_voz_so_vale_para_uma_sala_aberta() {
    let ctx = setup().await;
    let ana = join(&ctx, "Ana", 2, false).await;
    sqlx::query(
        "INSERT INTO channels (id, kind, name, category_id, position, created_at, archived_at)
         VALUES ('antiga', 'voice', 'Antiga', 'voz', 9, 0, 1)",
    )
    .execute(&ctx.db)
    .await
    .unwrap();

    // Canal de texto, sala que não existe e sala arquivada: 404, sem chegar ao
    // LiveKit (que nem está configurado aqui).
    for channel in ["geral", "nao-existe", "antiga"] {
        let (status, body) = call(
            &ctx.router,
            "POST",
            "/api/voice/token",
            Some(&ana),
            Some(json!({ "channel_id": channel })),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{channel}: {body}");
        let uri = format!("/api/voice/participants?channel_id={channel}");
        let (status, body) = call(&ctx.router, "GET", &uri, Some(&ana), None).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{channel}: {body}");
    }
}

#[tokio::test]
async fn criar_e_editar_sala_de_voz() {
    let ctx = setup().await;
    let owner = &ctx.owner_token;
    let (status, created) = create_channel(
        &ctx,
        owner,
        json!({ "kind": "voice", "name": "  Squad do Kid ", "category_id": "voz" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["kind"], "voice");
    assert_eq!(created["name"], "Squad do Kid", "o nome é livre");
    assert_eq!(created["topic"], Value::Null);
    let list = layout(&ctx, owner).await;
    assert_eq!(shape(&list), "topo[] Texto[geral] Voz[Sala,Squad do Kid]");

    // Sala de voz não tem tópico, nem ao criar nem ao editar; o nome segue a regra do rótulo.
    let (status, _) = create_channel(
        &ctx,
        owner,
        json!({ "kind": "voice", "name": "Papo", "topic": "um tópico" }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    for name in ["", &"a".repeat(33)] {
        let (status, _) =
            create_channel(&ctx, owner, json!({ "kind": "voice", "name": name })).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{name:?}");
    }
    let uri = format!("/api/channels/{}", created["id"].as_str().unwrap());
    let (status, _) = call(
        &ctx.router,
        "PATCH",
        &uri,
        Some(owner),
        Some(json!({ "topic": "outro" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Só quem gerencia os canais cria sala de voz.
    let ana = join(&ctx, "Ana", 2, false).await;
    let (status, _) = create_channel(&ctx, &ana, json!({ "kind": "voice", "name": "Minha" })).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // A sala nova vale para a voz: o token passa da conferência da sala e só
    // para na falta das chaves do LiveKit, que os testes não têm.
    let (status, body) = call(
        &ctx.router,
        "POST",
        "/api/voice/token",
        Some(&ana),
        Some(json!({ "channel_id": created["id"] })),
    )
    .await;
    assert_ne!(status, StatusCode::NOT_FOUND, "{body}");

    // Arquivada, a sala some da voz.
    let (status, _) = call(
        &ctx.router,
        "POST",
        &format!("{uri}/archive"),
        Some(owner),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = call(
        &ctx.router,
        "POST",
        "/api/voice/token",
        Some(&ana),
        Some(json!({ "channel_id": created["id"] })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
