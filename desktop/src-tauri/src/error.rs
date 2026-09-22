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
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field(
            "kind",
            &format!("{self:?}").split('(').next().unwrap_or_default(),
        )?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}
