//! Testes das regras de identidade sobre o banco de verdade (SQLite em memória,
//! ou em arquivo onde a concorrência importa).

use sqlx::SqlitePool;

use super::invites::{self, InviteKind, InviteStatus};
use super::permissions::{self, Origin, Permission};
use super::{User, devices, users};
use crate::db::{self, test_support};
use crate::error::ApiError;

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
    invites::redeem(pool, &invite.code, &key(n), Some(nick), NOW)
        .await
        .unwrap()
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
    let (again, _) = invites::redeem(&pool, &code, &key(1), Some("kid"), NOW + 12)
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
    let (kid, _) = invites::redeem(&pool, &code, &key(1), Some("Kid"), NOW)
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
    let (back, new_token) = invites::redeem(&pool, &code, &key(2), Some("Outro"), NOW)
        .await
        .unwrap();
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
    let (user, token) = invites::redeem(&pool, &code, &key(1), None, NOW)
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
    let (_, token) = invites::redeem(&pool, &code, &key(1), Some("Kid"), NOW)
        .await
        .unwrap();

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
    assert_eq!(owners, [(beta, Origin::Owner)]);

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
    let (path, url) = test_support::temp_db();
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
    test_support::remove_db(&path);

    assert_eq!(successes(&a, &b), 1);
    assert!(matches!(a, Err(ApiError::InvalidInvite)) || matches!(b, Err(ApiError::InvalidInvite)));
    assert_eq!(members, 2); // o dono e quem entrou
    assert_eq!(uses, 1);
}

#[tokio::test]
async fn a_mesma_chave_em_dois_convites_ao_mesmo_tempo_entra_uma_vez() {
    let (path, url) = test_support::temp_db();
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
    test_support::remove_db(&path);

    assert_eq!(successes(&a, &b), 1);
    assert!(
        matches!(a, Err(ApiError::DeviceAlreadyLinked))
            || matches!(b, Err(ApiError::DeviceAlreadyLinked))
    );
    assert_eq!(devices_count, 1);
}
