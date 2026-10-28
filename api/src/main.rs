use std::sync::Arc;

use api::{AppState, client_policy::ClientPolicy, db};
use dotenvy::dotenv;

#[tokio::main]
async fn main() {
    dotenv().ok();
    let policy = Arc::new(ClientPolicy::from_env());
    println!(
        "Versão mínima do cliente: {}; código de acesso: {}",
        policy
            .min_version
            .as_ref()
            .map_or("desligada".into(), |v| v.to_string()),
        if policy.access_code.is_some() {
            "ligado"
        } else {
            "desligado"
        },
    );
    let database_url = std::env::var("DATABASE_URL").expect("defina DATABASE_URL no .env");
    let public_url = std::env::var("PUBLIC_URL").expect("defina PUBLIC_URL no .env");

    let pool = db::connect(&database_url)
        .await
        .expect("não foi possivel abrir o banco");
    println!("Banco: {database_url}");

    println!("Endereço público: {public_url}");

    let app = api::app(AppState::new(pool, &public_url), policy);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000")
        .await
        .expect("FAILED TO BIND PORT 3000 !!!");

    println!("Server running at http://127.0.0.1:3000");

    axum::serve(listener, app)
        .await
        .expect("FAILED TO SERVE !!!");
}
