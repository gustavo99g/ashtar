use std::sync::Arc;

use api::{AppState, client_policy::ClientPolicy, db};
use dotenvy::dotenv;

#[tokio::main]
async fn main() {
    dotenv().ok();
    let policy = Arc::new(ClientPolicy::from_env());
    println!(
        "Versão mínima do cliente: {}",
        policy
            .min_version
            .as_ref()
            .map_or("desligada".into(), |v| v.to_string()),
    );
    let database_url = std::env::var("DATABASE_URL").expect("defina DATABASE_URL no .env");
    let public_url = std::env::var("PUBLIC_URL").expect("defina PUBLIC_URL no .env");

    let pool = db::connect(&database_url)
        .await
        .expect("não foi possivel abrir o banco");
    println!("Banco: {database_url}");

    // Uma ligação que estava tocando ou em andamento quando a API caiu não
    // tem mais quem a encerre: acaba agora, com o registro.
    match api::calls::close_stale(&pool, api::db::now()).await {
        Ok(0) => {}
        Ok(n) => println!("Ligações fechadas ao subir: {n}"),
        Err(error) => eprintln!("não deu para fechar as ligações abertas: {error}"),
    }

    println!("Endereço público: {public_url}");

    let state = AppState::new(pool, &public_url);
    println!("Arquivos: {}", state.files.root().display());
    // A limpeza dos arquivos não usados e o aviso do disco, de hora em hora (ADR 0031).
    let maintenance = state.clone();
    tokio::spawn(async move {
        let mut every = tokio::time::interval(api::FILE_MAINTENANCE_EVERY);
        loop {
            every.tick().await;
            api::maintain_files(&maintenance).await;
        }
    });

    let app = api::app(state, policy);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000")
        .await
        .expect("FAILED TO BIND PORT 3000 !!!");

    println!("Server running at http://127.0.0.1:3000");

    axum::serve(listener, app)
        .await
        .expect("FAILED TO SERVE !!!");
}
