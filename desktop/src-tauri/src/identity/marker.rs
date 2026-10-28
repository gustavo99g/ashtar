//! O marcador da conta: um arquivo pequeno na pasta de dados do app (`conta.json`), gravado depois
//! de um `login` ou `redeem` que deu certo, com o nick e o nome visível.
//!
//! Serve para separar "nunca entrou" de "saiu do grupo". Quando o login responde
//! `unknown_device`, o app lê o marcador: sem ele, é a primeira vez (a tela do convite); com ele,
//! este computador já teve uma conta, e a tela "saiu do grupo" mostra de quem era (a cor do avatar
//! sai do nick). Não é segredo, e a API não sabe dele.

use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const FILE_NAME: &str = "conta.json";

/// O que o marcador guarda. Espelhado no `commands.ts` (`AccountMarker`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountMarker {
    pub nick: String,
    pub display_name: Option<String>,
}

fn file(data_dir: &Path) -> PathBuf {
    data_dir.join(FILE_NAME)
}

/// Grava o marcador, trocando o que houver (o nick e o nome podem ter mudado desde o último).
///
/// # Bloqueia
///
/// Escreve no disco: chamar dentro de `run_blocking`.
pub fn write(data_dir: &Path, marker: &AccountMarker) -> io::Result<()> {
    std::fs::create_dir_all(data_dir)?;
    let json = serde_json::to_vec_pretty(marker).map_err(io::Error::other)?;
    std::fs::write(file(data_dir), json)
}

/// O marcador gravado, ou `None` se não há. Um arquivo que não dá para entender (cortado, mexido
/// à mão) também vale como `None`: a pior consequência é mostrar a tela do convite.
///
/// # Bloqueia
///
/// Lê do disco: chamar dentro de `run_blocking`.
pub fn read(data_dir: &Path) -> io::Result<Option<AccountMarker>> {
    match std::fs::read(file(data_dir)) {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes).ok()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Uma pasta vazia só deste teste, apagada no fim.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!("ashtar-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&path);
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn grava_e_le_o_marcador() {
        let dir = TempDir::new("marcador");
        assert_eq!(read(&dir.0).unwrap(), None);

        let marker = AccountMarker {
            nick: "kid".into(),
            display_name: Some("Kid".into()),
        };
        write(&dir.0, &marker).unwrap();
        assert_eq!(read(&dir.0).unwrap(), Some(marker));

        let renamed = AccountMarker {
            nick: "kid".into(),
            display_name: None,
        };
        write(&dir.0, &renamed).unwrap();
        assert_eq!(read(&dir.0).unwrap(), Some(renamed));
    }

    #[test]
    fn arquivo_estragado_vale_como_sem_marcador() {
        let dir = TempDir::new("estragado");
        std::fs::create_dir_all(&dir.0).unwrap();
        std::fs::write(file(&dir.0), b"{\"nick\": \"ki").unwrap();
        assert_eq!(read(&dir.0).unwrap(), None);
    }
}
