//! O chat: canais, categorias, mensagens e conversas privadas (ADRs 0015,
//! 0016 e 0021).
//!
//! Como em `identity`, as rotas (`routes/`) só chamam as regras daqui.

pub mod access;
pub mod categories;
pub mod channels;
pub mod dms;
pub mod layout;
pub mod messages;
