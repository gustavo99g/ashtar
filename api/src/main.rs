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

    let mut state = AppState::new(pool, &public_url);
    // A prévia de links nunca busca a própria VPS.
    state.previews = std::sync::Arc::new(api::previews::Guard {
        own: api::previews::own_addresses(&public_url).await,
        ..Default::default()
    });
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

    // A lista de jogos detectáveis do Discord, ao subir e uma vez por dia (ADR 0033).
    let games = state.games.clone();
    tokio::spawn(async move {
        let mut every = tokio::time::interval(api::games::REFRESH_EVERY);
        loop {
            every.tick().await;
            games.refresh().await;
        }
    });

    let app = api::app(state, policy);

    // Só neste computador, por padrão (o Funnel chega por aqui). `BIND_ADDR=0.0.0.0:3000` abre para
    // a rede local: é o que o Transmissor do Odin acha no modo Local (ADR 0038).
    let addr = std::env::var("BIND_ADDR")
        .ok()
        .map(|addr| addr.trim().to_owned())
        .filter(|addr| !addr.is_empty())
        .unwrap_or_else(|| "127.0.0.1:3000".to_owned());
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|error| panic!("FAILED TO BIND {addr} !!! {error}"));

    println!("Server running at http://{addr}");

    axum::serve(listener, app)
        .await
        .expect("FAILED TO SERVE !!!");
}
