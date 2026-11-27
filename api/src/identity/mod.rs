//! Regras de identidade: usuários, dispositivo, sessão, convites e permissões.
//!
//! As rotas HTTP (`routes/`) e o `admin` (`src/bin/admin.rs`) chamam as
//! mesmas funções daqui. Toda ação de administração recebe quem está fazendo
//! (`actor`) e passa por [`permissions::can`].

pub mod devices;
pub mod invites;
pub mod permissions;
pub mod status;
pub mod stream_devices;
pub mod users;

use sqlx::FromRow;

/// Um membro do grupo.
#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct User {
    pub id: String,
    pub nick: String,
    /// Nome visível; `None` quando está em branco, e aí aparece o nick.
    pub display_name: Option<String>,
    pub is_owner: bool,
    pub created_at: i64,
    pub removed_at: Option<i64>,
    /// O arquivo da foto de perfil (ADR 0031); `None` mostra a letra e a cor do nick.
    pub avatar_id: Option<String>,
}

impl User {
    pub fn is_active(&self) -> bool {
        self.removed_at.is_none()
    }
    /// O nome que aparece para o grupo: o nome visível ou, sem ele, o nick.
    pub fn shown_name(&self) -> &str {
        self.display_name.as_deref().unwrap_or(&self.nick)
    }
}
