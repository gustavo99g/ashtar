//! Abre o banco SQLite e aplica as migrações de `api/migrations/`.
//!
//! As migrações vão embutidas no binário (`sqlx::migrate!`), então a API e o
//! `admin` sempre sobem com o banco na versão que o código espera.

use std::{
    str::FromStr,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};

pub type DbError = Box<dyn std::error::Error + Send + Sync>;

/// Abre (ou cria) o banco em `url` (ex.: `sqlite://ashtar.db`) e migra.
///
/// Modo WAL: o `admin` consegue gravar com a API no ar.
pub async fn connect(url: &str) -> Result<SqlitePool, DbError> {
    let options = SqliteConnectOptions::from_str(url)?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;
    migrate(&pool).await?;
    Ok(pool)
}
/// Banco em memória, já migrado. Para os testes.
///
/// Uma conexão só: no SQLite, cada conexão `:memory:` é um banco diferente.
pub async fn connect_in_memory() -> Result<SqlitePool, DbError> {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")?.foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await?;
    migrate(&pool).await?;
    Ok(pool)
}

async fn migrate(pool: &SqlitePool) -> Result<(), DbError> {
    sqlx::migrate!().run(pool).await?;
    Ok(())
}

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

/// Apoio para os testes que precisam de um banco em arquivo.
#[cfg(test)]
pub(crate) mod test_support {
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// Caminho de um banco temporário só deste teste (e a URL para abri-lo).
    pub fn temp_db() -> (std::path::PathBuf, String) {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("ashtar-test-{}-{nanos}-{n}.db", std::process::id()));
        let url = format!("sqlite:{}", path.display().to_string().replace('\\', "/"));
        (path, url)
    }

    pub fn remove_db(path: &std::path::Path) {
        for suffix in ["", "-wal", "-shm"] {
            let mut file = path.as_os_str().to_owned();
            file.push(suffix);
            let _ = std::fs::remove_file(file);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{remove_db, temp_db};
    use super::*;

    async fn insert_user(pool: &SqlitePool, id: &str, nick: &str) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT INTO users (id, nick, created_at) VALUES (?, ?, 0)")
            .bind(id)
            .bind(nick)
            .execute(pool)
            .await
            .map(|_| ())
    }

    #[tokio::test]
    async fn as_migracoes_criam_as_tabelas() {
        let pool = connect_in_memory().await.unwrap();

        let tables: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite%' AND name != '_sqlx_migrations' ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        assert_eq!(
            tables,
            [
                "devices",
                "invite_uses",
                "invites",
                "sessions",
                "user_permissions",
                "users"
            ]
        );
    }

    #[tokio::test]
    async fn abrir_de_novo_nao_refaz_as_migracoes() {
        let (path, url) = temp_db();

        let pool = connect(&url).await.unwrap();
        insert_user(&pool, "u1", "Gustavo").await.unwrap();
        pool.close().await;

        let pool = connect(&url).await.unwrap();
        let users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(&pool)
            .await
            .unwrap();
        let applied: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
            .fetch_one(&pool)
            .await
            .unwrap();
        pool.close().await;
        remove_db(&path);

        assert_eq!(users, 1);
        assert_eq!(applied, 1);
    }

    #[tokio::test]
    async fn as_chaves_estrangeiras_estao_ligadas() {
        let pool = connect_in_memory().await.unwrap();

        let on: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(on, 1);

        // Dispositivo de um usuário que não existe.
        let orphan = sqlx::query(
            "INSERT INTO devices (id, user_id, key_hash, linked_at) VALUES ('d', 'nope', 'k', 0)",
        )
        .execute(&pool)
        .await;
        assert!(orphan.is_err());
    }

    #[tokio::test]
    async fn apagar_o_dispositivo_apaga_a_sessao() {
        let pool = connect_in_memory().await.unwrap();
        insert_user(&pool, "u1", "Gustavo").await.unwrap();
        sqlx::query(
            "INSERT INTO devices (id, user_id, key_hash, linked_at) VALUES ('d1', 'u1', 'k', 0)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO sessions (token_hash, device_id, created_at, last_seen_at) VALUES ('t', 'd1', 0, 0)")
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query("DELETE FROM devices WHERE id = 'd1'")
            .execute(&pool)
            .await
            .unwrap();

        let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(sessions, 0);
    }

    #[tokio::test]
    async fn o_nick_e_unico_entre_ativos_e_tem_de_2_a_32_caracteres() {
        let pool = connect_in_memory().await.unwrap();
        insert_user(&pool, "u1", "Gustavo").await.unwrap();

        // Maiúscula e minúscula contam como o mesmo nick.
        assert!(insert_user(&pool, "u2", "GUSTAVO").await.is_err());
        // Tamanho.
        assert!(insert_user(&pool, "u3", "g").await.is_err());
        assert!(insert_user(&pool, "u4", &"g".repeat(33)).await.is_err());
        assert!(insert_user(&pool, "u5", &"g".repeat(32)).await.is_ok());

        // Quem foi removido libera o nick.
        sqlx::query("UPDATE users SET removed_at = 1 WHERE id = 'u1'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(insert_user(&pool, "u6", "gustavo").await.is_ok());
    }

    #[tokio::test]
    async fn so_existe_um_dono_e_um_dispositivo_por_usuario() {
        let pool = connect_in_memory().await.unwrap();
        let owner = |id: &'static str, nick: &'static str| {
            sqlx::query("INSERT INTO users (id, nick, is_owner, created_at) VALUES (?, ?, 1, 0)")
                .bind(id)
                .bind(nick)
        };
        owner("u1", "dono").execute(&pool).await.unwrap();
        assert!(owner("u2", "outro").execute(&pool).await.is_err());

        let device = |id: &'static str, key: &'static str| {
            sqlx::query(
                "INSERT INTO devices (id, user_id, key_hash, linked_at) VALUES (?, 'u1', ?, 0)",
            )
            .bind(id)
            .bind(key)
        };
        device("d1", "k1").execute(&pool).await.unwrap();
        assert!(device("d2", "k2").execute(&pool).await.is_err());
    }

    #[tokio::test]
    async fn os_limites_dos_convites_valem() {
        let pool = connect_in_memory().await.unwrap();
        insert_user(&pool, "u1", "Gustavo").await.unwrap();

        let invite = |id: &'static str,
                      kind: &'static str,
                      max_uses: i64,
                      target: Option<&'static str>| {
            sqlx::query(
                "INSERT INTO invites (id, code_hash, kind, target_user_id, max_uses, created_by, created_at, expires_at)                  VALUES (?, ?, ?, ?, ?, 'u1', 0, 1)",
            )
            .bind(id)
            .bind(id)
            .bind(kind)
            .bind(target)
            .bind(max_uses)
        };

        assert!(invite("i1", "new", 1, None).execute(&pool).await.is_ok());
        assert!(invite("i2", "new", 50, None).execute(&pool).await.is_ok());
        assert!(invite("i3", "new", 0, None).execute(&pool).await.is_err());
        assert!(invite("i4", "new", 51, None).execute(&pool).await.is_err());
        // A recuperação aponta para um usuário e vale uma vez só.
        assert!(
            invite("i5", "recovery", 1, Some("u1"))
                .execute(&pool)
                .await
                .is_ok()
        );
        assert!(
            invite("i6", "recovery", 2, Some("u1"))
                .execute(&pool)
                .await
                .is_err()
        );
        assert!(
            invite("i7", "recovery", 1, None)
                .execute(&pool)
                .await
                .is_err()
        );
        assert!(
            invite("i8", "new", 1, Some("u1"))
                .execute(&pool)
                .await
                .is_err()
        );
    }
}
