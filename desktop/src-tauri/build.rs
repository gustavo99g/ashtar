//! Roda antes de compilar o app: gera o contexto do Tauri e passa ao Rust as variáveis do `.env`
//! que ele divide com o frontend.

use std::env;
use std::fs;
use std::path::PathBuf;

/// As variáveis do `.env` da raiz que o Rust também lê, com `option_env!` (`src/api/config.rs`).
const SHARED_VARS: [&str; 2] = ["VITE_API_URL", "VITE_ACCESS_CODE"];

fn main() {
    forward_dotenv();
    tauri_build::build()
}

/// O Vite lê o `.env` da raiz e grava os valores no frontend; o cargo não lê arquivo nenhum. Aqui
/// as mesmas variáveis chegam ao Rust, com a regra do Vite: a que já está no ambiente vence a do
/// arquivo. No CI de release não há `.env`, e as duas vêm do ambiente (`release.yml`).
fn forward_dotenv() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let dotenv = manifest_dir.join("../../.env");
    // Enquanto o arquivo não existe, o cargo roda este script a cada build e percebe quando ele
    // aparecer; depois, só quando ele muda.
    println!("cargo:rerun-if-changed={}", dotenv.display());
    let contents = fs::read_to_string(&dotenv).unwrap_or_default();

    for name in SHARED_VARS {
        println!("cargo:rerun-if-env-changed={name}");
        if env::var_os(name).is_some() {
            // O compilador herda o ambiente do cargo: o `option_env!` já enxerga esta.
            continue;
        }
        if let Some(value) = dotenv_value(&contents, name) {
            println!("cargo:rustc-env={name}={value}");
        }
    }
}

/// O valor de `name` num `.env`: linhas `NOME=valor`, `#` para comentário, aspas opcionais em
/// volta do valor. Se o nome aparece duas vezes, vale a última, como no Vite.
fn dotenv_value<'a>(contents: &'a str, name: &str) -> Option<&'a str> {
    let mut found = None;
    for line in contents.lines() {
        let line = line.trim();
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if key.trim() != name {
            continue;
        }
        let value = value.trim();
        found = Some(match value.chars().next() {
            Some(quote @ ('"' | '\'')) => value[1..].split(quote).next().unwrap_or_default(),
            // Sem aspas, um ` #` começa um comentário no fim da linha.
            _ => value.split(" #").next().unwrap_or_default().trim_end(),
        });
    }
    found
}
