//! Tipo de erro único dos comandos Tauri (`Result<T, AppError>`).
//!
//! Serializado para o frontend como `{ kind, message }` (ver `commands.ts`,
//! que espelha `AppErrorKind`) em vez de string livre, para o React poder
//! tratar casos específicos (ex.: `SourceNotFound`) sem comparar texto de
//! mensagem. `kind()` usa um `match` explícito, sem `_`, para o compilador
//! obrigar a tratar variantes novas nos dois lugares (aqui e no TS).

use serde::ser::{Serialize, SerializeStruct, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("fonte de captura não encontrada: {0}")]
    SourceNotFound(u64),
    #[error("já existe um compartilhamento ativo")]
    AlreadySharing,
    #[error("falha na captura de vídeo: {0}")]
    VideoCapture(String),
    #[error("falha na captura de áudio: {0}")]
    AudioCapture(String),
    #[error("falha na transmissão: {0}")]
    Publish(String),
    #[error("erro interno: {0}")]
    Internal(String),
    #[error("falha na atualização: {0}")]
    Update(String),
    #[error("recurso não suportado nesta plataforma: {0}")]
    // Só é construída fora do Windows (`media/platform/unsupported.rs`).
    #[cfg_attr(windows, allow(dead_code))]
    Unsupported(&'static str),
}

impl AppError {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::SourceNotFound(_) => "SourceNotFound",
            Self::AlreadySharing => "AlreadySharing",
            Self::VideoCapture(_) => "VideoCapture",
            Self::AudioCapture(_) => "AudioCapture",
            Self::Publish(_) => "Publish",
            Self::Internal(_) => "Internal",
            Self::Unsupported(_) => "Unsupported",
            Self::Update(_) => "Update",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}
