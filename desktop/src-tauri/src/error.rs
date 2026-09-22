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
    #[error("erro interno: {0}")]
    Internal(String),
}

impl AppError {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::SourceNotFound(_) => "SourceNotFound",
            Self::AlreadySharing => "AlreadySharing",
            Self::VideoCapture(_) => "VideoCapture",
            Self::AudioCapture(_) => "AudioCapture",
            Self::Internal(_) => "Internal",
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
