//! `admin`: administração do grupo pela linha de comando.
//!
//! Roda no computador da API, com o mesmo `.env` (`DATABASE_URL`). Age como o
//! dono: quem tem acesso a este computador já tem acesso ao banco. Pode rodar
//! com a API no ar (o banco está em modo WAL).
//!
//! `cargo run --bin admin -- --help` lista os comandos.

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Duration;

use api::db::{self, now};
use api::error::ApiError;
use api::identity::permissions::{self, Origin, Permission};
use api::identity::{User, devices, invites, users};
use api::limiter::SendLimiter;
use chrono::{DateTime, Local};
use clap::{Parser, Subcommand, ValueEnum};
use sqlx::SqlitePool;

#[derive(Parser)]
#[command(name = "admin", about = "Administração do grupo do Ashtar")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Cria o dono do grupo (uma vez só).
    Dono { nick: String },
    /// Cria um convite para gente nova. Para mandar no grupo: --validade 5m --usos 8.
    Convite {
        /// Validade: 30m, 12h, 7d...
        #[arg(long, default_value = "7d", value_parser = parse_ttl)]
        validade: i64,
        /// Quantas pessoas podem entrar com ele (de 1 a 50).
        #[arg(long, default_value_t = 1)]
        usos: i64,
    },
    /// Cria um convite de recuperação: o membro passa a usar outro computador.
    Recuperacao {
        nick: String,
        #[arg(long, default_value = "7d", value_parser = parse_ttl)]
        validade: i64,
    },
    /// Histórico de convites: quem criou, quem usou e a situação.
    Convites,
    /// Revoga um convite que ainda não foi usado (id ou o começo dele).
    Revogar { id: String },
    /// Lista os membros, os removidos inclusive.
    Membros,
    /// Remove um membro do grupo.
    Remover { nick: String },
    /// Desvincula o computador de um membro (volta com convite de recuperação).
    Desvincular { nick: String },
    /// Liga ou desliga as versões beta para um membro.
    Beta { nick: String, estado: Estado },
    /// Mostra as permissões de um membro e de onde cada uma vem.
    Permissoes { nick: String },
    /// Só no desenvolvimento: cria três membros de teste e enche o #geral de
    /// mensagens dos últimos dias, para ver o chat com histórico.
    Semear {
        /// Quantas mensagens (de 1 a 2000).
        #[arg(long, default_value_t = 300, value_parser = clap::value_parser!(u16).range(1..=2000))]
        mensagens: u16,
    },
    /// Copia o banco para a pasta, com data no nome, e apaga as cópias mais antigas.
    Backup {
        pasta: PathBuf,
        /// Quantas cópias manter na pasta (pelo menos 1).
        #[arg(long, default_value_t = 14, value_parser = parse_keep)]
        manter: usize,
    },
}

#[derive(Clone, Copy, ValueEnum)]
enum Estado {
    Ligar,
    Desligar,
}

#[tokio::main]
async fn main() -> ExitCode {
    dotenvy::dotenv().ok();
    let cli = Cli::parse();

    let Ok(url) = std::env::var("DATABASE_URL") else {
        eprintln!("Defina DATABASE_URL no .env.");
        return ExitCode::FAILURE;
    };
    let db = match db::connect(&url).await {
        Ok(db) => db,
        Err(error) => {
            eprintln!("Não foi possível abrir o banco ({url}): {error}");
            return ExitCode::FAILURE;
        }
    };

    match run(&db, cli.command).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            // Aqui quem lê é você, no terminal: os erros internos saem com o detalhe.
            match error {
                ApiError::Internal(error) => eprintln!("Erro no banco: {error}"),
                ApiError::Config(message) => eprintln!("{message}"),
                other => eprintln!("{other}"),
            }
            ExitCode::FAILURE
        }
    }
}

async fn run(db: &SqlitePool, command: Command) -> Result<(), ApiError> {
    let now = now();

    if let Command::Dono { nick } = &command {
        let owner = users::create_owner(db, nick, now).await?;
        println!("Dono criado: {}", owner.nick);
        println!("Para vincular o seu computador, use um convite de recuperação para você mesmo.");
        return Ok(());
    }

    let owner = users::find_owner(db).await?.ok_or_else(|| {
        ApiError::NotFound("Ainda não há dono. Rode primeiro: admin dono <nick>".into())
    })?;

    match command {
        Command::Dono { .. } => unreachable!("tratado acima"),
        Command::Semear { mensagens } => seed(db, &owner, mensagens.into(), now).await?,
        Command::Convite { validade, usos } => {
            let invite = invites::create(
                db,
                &owner,
                invites::InviteKind::New,
                None,
                validade,
                usos,
                now,
            )
            .await?;
            print_created(&invite);
        }
        Command::Recuperacao { nick, validade } => {
            let target = users::get_active_by_nick(db, &nick).await?;
            let invite = invites::create(
                db,
                &owner,
                invites::InviteKind::Recovery,
                Some(&target),
                validade,
                1,
                now,
            )
            .await?;
            print_created(&invite);
            println!(
                "Ao ser usado, o computador atual de {} deixa de entrar.",
                target.nick
            );
        }
        Command::Convites => {
            for invite in invites::list(db).await? {
                print_invite(&invite, now);
            }
        }
        Command::Revogar { id } => {
            invites::revoke(db, &owner, &id, now).await?;
            println!("Convite revogado.");
        }
        Command::Membros => {
            for user in users::list(db).await? {
                print_user(db, &user).await?;
            }
        }
        Command::Remover { nick } => {
            let target = users::get_active_by_nick(db, &nick).await?;
            users::remove(db, &owner, &target, now).await?;
            println!("{} foi removido.", target.nick);
        }
        Command::Desvincular { nick } => {
            let target = users::get_active_by_nick(db, &nick).await?;
            devices::unlink(db, &owner, &target).await?;
            println!("Computador de {} desvinculado.", target.nick);
        }
        Command::Beta { nick, estado } => {
            let target = users::get_active_by_nick(db, &nick).await?;
            let on = matches!(estado, Estado::Ligar);
            permissions::set(db, &owner, &target, Permission::BetaUpdates, on, now).await?;
            println!(
                "Beta {} para {}.",
                if on { "ligado" } else { "desligado" },
                target.nick
            );
        }
        Command::Permissoes { nick } => {
            let target = users::get_active_by_nick(db, &nick).await?;
            let effective = permissions::effective(db, &target).await?;
            if effective.is_empty() {
                println!("{} não tem permissões além das de membro.", target.nick);
            }
            for (permission, origin) in effective {
                let origin = match origin {
                    Origin::Owner => "dono",
                    Origin::Direct => "direta",
                };
                println!("{:<20} ({origin})", permission.key());
            }
        }
        Command::Backup { pasta, manter } => {
            let file = backup(db, &pasta, manter).await?;
            println!("Backup em {}", file.display());
        }
    }
    Ok(())
}

/// "30m", "12h" ou "7d" em segundos.
fn parse_ttl(value: &str) -> Result<i64, String> {
    let invalid = || format!("validade inválida: {value} (use 30m, 12h, 7d)");

    // A unidade é o último caractere (pode não ser ASCII: não cortar por byte).
    let unit = value.chars().next_back().ok_or_else(invalid)?;
    let number = &value[..value.len() - unit.len_utf8()];
    let seconds: i64 = match unit {
        'm' => 60,
        'h' => 60 * 60,
        'd' => 24 * 60 * 60,
        _ => return Err(invalid()),
    };
    let number: i64 = number.parse().map_err(|_| invalid())?;
    if number <= 0 {
        return Err("a validade precisa ser maior que zero".into());
    }
    // Um número enorme não pode estourar: a faixa válida é conferida depois, ao criar.
    number.checked_mul(seconds).ok_or_else(invalid)
}

/// Quantas cópias do backup manter: pelo menos 1, senão a que acabou de ser feita
/// seria apagada.
fn parse_keep(value: &str) -> Result<usize, String> {
    match value.parse::<usize>() {
        Ok(keep) if keep >= 1 => Ok(keep),
        _ => Err("use um número inteiro maior que zero".into()),
    }
}

fn date(seconds: i64) -> String {
    DateTime::from_timestamp(seconds, 0)
        .map(|utc| {
            utc.with_timezone(&Local)
                .format("%d/%m/%Y %H:%M")
                .to_string()
        })
        .unwrap_or_else(|| "?".into())
}

fn print_created(invite: &invites::CreatedInvite) {
    println!("Código: {}", invite.code);
    let people = if invite.max_uses == 1 {
        "uma pessoa".to_owned()
    } else {
        format!("até {} pessoas", invite.max_uses)
    };
    println!(
        "Vale até {} para {people}. Ele não aparece de novo: copie agora.",
        date(invite.expires_at)
    );
}

fn print_invite(invite: &invites::InviteRecord, now: i64) {
    let kind = match &invite.target_nick {
        Some(target) => format!("recuperação de {target}"),
        None => "novo".into(),
    };
    let status = match invite.status(now) {
        invites::InviteStatus::Pending => format!("pendente até {}", date(invite.expires_at)),
        invites::InviteStatus::Exhausted => "esgotado".into(),
        invites::InviteStatus::Revoked => {
            format!(
                "revogado em {}",
                invite.revoked_at.map(date).unwrap_or_default()
            )
        }
        invites::InviteStatus::Expired => format!("expirou em {}", date(invite.expires_at)),
    };
    println!(
        "{}  {}  criado por {} em {}  {}  ({} de {} usos)",
        &invite.id[..8],
        kind,
        invite.created_by_nick,
        date(invite.created_at),
        status,
        invite.uses.len(),
        invite.max_uses
    );
    for used in &invite.uses {
        println!("          {} entrou em {}", used.nick, date(used.used_at));
    }
}

async fn print_user(db: &SqlitePool, user: &User) -> Result<(), ApiError> {
    let mut tags = Vec::new();
    if user.is_owner {
        tags.push("dono".to_owned());
    }
    if let Some(removed_at) = user.removed_at {
        tags.push(format!("removido em {}", date(removed_at)));
    } else {
        if !devices::has_device(db, user).await? {
            tags.push("sem computador".to_owned());
        }
        if permissions::has(db, user, Permission::BetaUpdates).await? {
            tags.push("beta".to_owned());
        }
    }
    println!(
        "{:<32} desde {}  {}",
        user.nick,
        date(user.created_at),
        tags.join(", ")
    );
    Ok(())
}

/// `VACUUM INTO`: o SQLite escreve uma cópia consistente do banco, mesmo com
/// a API gravando ao mesmo tempo. Copiar o arquivo `.db` à mão não é seguro
/// em modo WAL (parte dos dados pode estar no `-wal`).
async fn backup(db: &SqlitePool, folder: &Path, keep: usize) -> Result<PathBuf, ApiError> {
    std::fs::create_dir_all(folder).map_err(|e| {
        ApiError::Config(format!("não foi possível criar {}: {e}", folder.display()))
    })?;
    // Com os milissegundos no nome, dois backups no mesmo segundo não colidem (o
    // `VACUUM INTO` recusa um arquivo que já existe). A largura é fixa, então a ordem
    // alfabética continua sendo a cronológica.
    let name = format!("ashtar-{}.db", Local::now().format("%Y-%m-%d-%H%M%S%3f"));
    let file = folder.join(name);

    sqlx::query("VACUUM INTO ?")
        .bind(file.to_string_lossy().into_owned())
        .execute(db)
        .await?;

    // Os nomes têm a data, então a ordem alfabética é a cronológica.
    let mut copies: Vec<PathBuf> = std::fs::read_dir(folder)
        .map_err(|e| ApiError::Config(e.to_string()))?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| {
            path.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("ashtar-") && n.ends_with(".db"))
        })
        .collect();
    copies.sort();
    // Nunca apaga a cópia que acabou de ser feita, mesmo que `keep` venha zerado.
    let excess = copies.len().saturating_sub(keep.max(1));
    for old in copies[..excess].iter().filter(|path| **path != file) {
        let _ = std::fs::remove_file(old);
    }
    Ok(file)
}

/// Os nicks dos membros de teste do `semear`.
const SEED_NICKS: [&str; 3] = ["ana", "bia", "caio"];

/// Frases para as mensagens de teste, com links e linhas quebradas no meio.
const SEED_LINES: [&str; 8] = [
    "bora jogar hoje?",
    "alguém viu o patch novo?",
    "https://github.com/gustavo99g/discord",
    "to entrando na sala",
    "kkkkkkk",
    "primeira linha\nsegunda linha",
    "amanhã eu não consigo, tenho prova",
    "fechou, 21h então",
];

/// Enche o banco de desenvolvimento. Recusa se a `PUBLIC_URL` não for local:
/// no computador de casa, isso criaria gente de mentira no grupo de verdade.
async fn seed(db: &SqlitePool, owner: &User, count: usize, now: i64) -> Result<(), ApiError> {
    let public_url = std::env::var("PUBLIC_URL").unwrap_or_default();
    if !(public_url.contains("127.0.0.1") || public_url.contains("localhost")) {
        return Err(ApiError::Config(
            "O semear é só para o desenvolvimento: a PUBLIC_URL precisa ser local.".into(),
        ));
    }
    let mut people = vec![owner.clone()];
    for nick in SEED_NICKS {
        let user = match users::find_active_by_nick(db, nick).await? {
            Some(user) => user,
            None => users::create_seed_member(db, nick, now).await?,
        };
        people.push(user);
    }
    let channel = api::chat::channels::get_open_text(db, "geral").await?;
    // O id (UUID v7) sai com a hora da gravação e o `created_at` vai para o passado: num #geral
    // que já tem mensagens, as novas ficariam no fim da lista com datas de dias atrás.
    let existing: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE channel_id = ?")
        .bind(&channel.id)
        .fetch_one(db)
        .await?;
    if existing > 0 {
        return Err(ApiError::Conflict(format!(
            "O #geral já tem {existing} mensagens: o semear só roda nele vazio, para a ordem \
             do histórico bater com as datas. Comece de um banco novo."
        )));
    }
    // O limite de envio é do app; aqui as mensagens saem todas de uma vez.
    let limiter = SendLimiter::new(usize::MAX, Duration::from_secs(1));
    // Espalhadas pelos últimos três dias, da mais antiga para a mais nova (o id
    // UUID v7 sai em ordem de inserção, igual ao tempo).
    let span = 3 * 24 * 60 * 60;
    for i in 0..count {
        let author = &people[(i * 7 + i / 3) % people.len()];
        let line = SEED_LINES[(i * 5) % SEED_LINES.len()];
        let at = now - span + (span * i as i64) / count as i64;
        api::chat::messages::create(
            db,
            &limiter,
            &channel,
            author,
            &format!("semear-{now}-{i}"),
            &format!("{line} ({})", i + 1),
            at,
        )
        .await?;
    }
    println!(
        "{count} mensagens no #geral, de {}.",
        people
            .iter()
            .map(|p| p.nick.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    );
    Ok(())
}
