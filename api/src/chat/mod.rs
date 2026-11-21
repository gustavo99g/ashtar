//! O chat: canais, categorias, mensagens, conversas privadas, lidas e menções
//! (ADRs 0015, 0016, 0021 e 0022).
//!
//! Como em `identity`, as rotas (`routes/`) só chamam as regras daqui.

pub mod access;
pub mod categories;
pub mod channels;
pub mod dms;
pub mod layout;
pub mod media;
pub mod mentions;
pub mod messages;
pub mod read;
pub mod search;
