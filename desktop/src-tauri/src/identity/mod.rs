//! A chave deste computador (ADR 0013): a credencial com que o app entra na API sem senha.
//!
//! [`device_key`] é a única porta. Ela lê o UUID do sistema e o serial da placa-mãe na tabela
//! SMBIOS (`smbios.rs`); se os dois servem, a chave é o hash deles (`key.rs`). Se algum é
//! genérico, ou a tabela não dá para ler, a chave é aleatória: 32 bytes gerados uma vez e
//! guardados no Gerenciador de Credenciais do Windows (`windows.rs`).
//!
//! Regras:
//!
//! - a chave nunca sai do Rust: quem a usa são os comandos `login` e `redeem`
//!   (`commands/identity.rs`), que devolvem ao JavaScript só a sessão;
//! - o log diz o caminho ("hardware" ou "aleatória") e o motivo, nunca os valores;
//! - o nome da credencial leva o identificador do app, então o app de desenvolvimento
//!   (`com.gustavo99g.ashtar.dev`) tem a sua própria chave aleatória.
//!
//! O `marker.rs` guarda a outra metade da identidade, que não é segredo: de quem era a conta
//! deste computador, para a tela "saiu do grupo".

mod key;
pub mod marker;
mod smbios;
#[cfg(target_os = "windows")]
mod windows;

use std::io;
use std::sync::{Mutex, PoisonError};

use tauri::AppHandle;
use tracing::{info, warn};

#[cfg(target_os = "windows")]
use self::windows as platform;

/// Fora do Windows não há tabela nem cofre: o app só roda no Windows, e isto só existe para o
/// crate compilar nos testes de outras plataformas.
#[cfg(not(target_os = "windows"))]
mod platform {
    use std::io;

    fn unsupported() -> io::Error {
        io::Error::new(io::ErrorKind::Unsupported, "só no Windows")
    }

    pub fn read_smbios() -> io::Result<Vec<u8>> {
        Err(unsupported())
    }

    pub fn read_credential(_target: &str) -> io::Result<Option<Vec<u8>>> {
        Err(unsupported())
    }

    pub fn write_credential(_target: &str, _blob: &[u8]) -> io::Result<()> {
        Err(unsupported())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum KeyError {
    #[error("Gerenciador de Credenciais: {0}")]
    Credential(io::Error),
    #[error("a credencial guardada tem {0} bytes, e não 32")]
    StoredSize(usize),
    #[error("gerador aleatório do sistema: {0}")]
    Random(getrandom::Error),
}

/// Duas chamadas ao mesmo tempo (o login e um redeem) não podem gerar duas chaves aleatórias.
static RANDOM_KEY: Mutex<()> = Mutex::new(());

/// A chave deste computador: 64 caracteres hexadecimais.
///
/// # Bloqueia
///
/// Lê o firmware e, no caminho aleatório, o Gerenciador de Credenciais: chamar dentro de
/// `spawn_blocking`.
pub fn device_key(app: &AppHandle) -> Result<String, KeyError> {
    let reason = match platform::read_smbios() {
        Ok(raw) => match key::hardware_key(&smbios::parse(&raw)) {
            Ok(key) => {
                info!(caminho = "hardware", "chave do computador");
                return Ok(key);
            }
            Err(generic) => generic.describe(),
        },
        Err(error) => {
            warn!(%error, "não foi possível ler a tabela SMBIOS");
            "tabela SMBIOS ilegível"
        }
    };

    let (key, created) = random_key(&credential_target(app))?;
    info!(
        caminho = "aleatória",
        motivo = reason,
        criada_agora = created,
        "chave do computador"
    );
    Ok(key)
}

/// O nome da credencial no Gerenciador de Credenciais: `com.gustavo99g.ashtar/device-key`.
fn credential_target(app: &AppHandle) -> String {
    format!("{}/device-key", app.config().identifier)
}

/// A chave aleatória guardada, ou uma nova, gravada antes de ser usada. Diz se foi criada agora.
fn random_key(target: &str) -> Result<(String, bool), KeyError> {
    let _guard = RANDOM_KEY.lock().unwrap_or_else(PoisonError::into_inner);

    if let Some(stored) = platform::read_credential(target).map_err(KeyError::Credential)? {
        let bytes: [u8; 32] = stored
            .as_slice()
            .try_into()
            .map_err(|_| KeyError::StoredSize(stored.len()))?;
        return Ok((key::random_key(&bytes), false));
    }

    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(KeyError::Random)?;
    platform::write_credential(target, &bytes).map_err(KeyError::Credential)?;
    Ok((key::random_key(&bytes), true))
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    /// Para rodar no seu Windows: `cargo test caminho_da_chave -- --ignored --nocapture`.
    /// Mostra o caminho que este computador segue, sem os valores.
    #[test]
    #[ignore = "lê o firmware deste computador"]
    fn caminho_da_chave_neste_computador() {
        let raw = platform::read_smbios().expect("o Windows deveria entregar a tabela SMBIOS");
        let ids = smbios::parse(&raw);
        println!("SMBIOS {}.{}", raw[1], raw[2]);
        println!(
            "tem uuid: {}; tem serial da placa: {}",
            ids.system_uuid.is_some(),
            ids.board_serial.is_some()
        );
        match key::hardware_key(&ids) {
            Ok(_) => println!("caminho: hardware"),
            Err(generic) => println!("caminho: aleatória ({})", generic.describe()),
        }
    }
}
