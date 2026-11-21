//! Onde os bytes dos arquivos ficam (ADR 0031, decisão 1): por enquanto o disco da VPS, em
//! `FILES_DIR` (padrão `<pasta dos dados>/files`), em `ab/cd/<id>`, com as duas pastas tiradas do
//! próprio id para não juntar milhares de arquivos numa pasta. O arquivo no disco nunca tem o nome
//! original. Um R2, se vier, é outra implementação destes três métodos.

use std::path::{Path, PathBuf};

use tokio::fs;
use tokio::io::AsyncWriteExt;

use crate::error::ApiError;

#[derive(Debug, Clone)]
pub struct FileStore {
    root: PathBuf,
}

/// O id de um arquivo: um UUID (letras, números e hífen). Qualquer outra coisa não vira caminho.
pub fn valid_id(id: &str) -> bool {
    (8..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
}

impl FileStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// `FILES_DIR`, ou `files` dentro da pasta dos dados.
    pub fn from_env(data_dir: &Path) -> Self {
        match std::env::var("FILES_DIR") {
            Ok(dir) if !dir.trim().is_empty() => Self::new(dir),
            _ => Self::new(data_dir.join("files")),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn path_of(&self, id: &str) -> PathBuf {
        let compact: String = id.chars().filter(|c| *c != '-').collect();
        // O fim do UUID v7 é o aleatório: as pastas ficam bem espalhadas.
        let tail = &compact[compact.len().saturating_sub(4)..];
        self.root.join(&tail[..2]).join(&tail[2..]).join(id)
    }

    /// Começa a gravar o arquivo `id`: os pedaços vão para um `.part`, que só vira o arquivo no
    /// [`Upload::finish`]. Se o envio parar no meio, o [`Upload`] apaga o `.part` ao sair.
    pub async fn put(&self, id: &str) -> Result<Upload, ApiError> {
        debug_assert!(valid_id(id));
        let target = self.path_of(id);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).await?;
        }
        let partial = target.with_extension("part");
        let file = fs::File::create(&partial).await?;
        Ok(Upload {
            file: Some(file),
            partial,
            target,
            done: false,
        })
    }

    /// Abre o arquivo `id` para ler.
    pub async fn open(&self, id: &str) -> Result<fs::File, ApiError> {
        if !valid_id(id) {
            return Err(ApiError::NotFound("Esse arquivo não existe.".into()));
        }
        fs::File::open(self.path_of(id)).await.map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                ApiError::NotFound("Esse arquivo não existe.".into())
            } else {
                error.into()
            }
        })
    }

    /// Apaga o arquivo `id`. Se ele já não existe, não é erro.
    pub async fn delete(&self, id: &str) -> Result<(), ApiError> {
        if !valid_id(id) {
            return Ok(());
        }
        match fs::remove_file(self.path_of(id)).await {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.into()),
            _ => Ok(()),
        }
    }
}

/// Um arquivo sendo gravado.
pub struct Upload {
    file: Option<fs::File>,
    partial: PathBuf,
    target: PathBuf,
    done: bool,
}

impl Upload {
    pub async fn write(&mut self, chunk: &[u8]) -> Result<(), ApiError> {
        if let Some(file) = &mut self.file {
            file.write_all(chunk).await?;
        }
        Ok(())
    }

    /// Termina: o `.part` vira o arquivo.
    pub async fn finish(mut self) -> Result<(), ApiError> {
        if let Some(mut file) = self.file.take() {
            file.flush().await?;
            file.sync_all().await?;
        }
        fs::rename(&self.partial, &self.target).await?;
        self.done = true;
        Ok(())
    }
}

impl Drop for Upload {
    fn drop(&mut self) {
        if !self.done {
            let _ = std::fs::remove_file(&self.partial);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn so_uuid_vira_caminho() {
        assert!(valid_id("0192b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7b"));
        assert!(!valid_id("../../etc/passwd"));
        assert!(!valid_id("abc"));
        assert!(!valid_id("0192b3c4/d5e6"));
    }

    #[test]
    fn o_caminho_usa_o_fim_do_id() {
        let store = FileStore::new("/data/files");
        assert_eq!(
            store.path_of("0192b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7b"),
            PathBuf::from("/data/files/6a/7b/0192b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7b")
        );
    }
}
