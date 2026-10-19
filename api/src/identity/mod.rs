//! Regras de identidade: usuários, dispositivo, sessão, convites e permissões.
//!
//! As rotas HTTP (`routes/`) e o `admin` (`src/bin/admin.rs`) chamam as
//! mesmas funções daqui. Toda ação de administração recebe quem está fazendo
//! (`actor`) e passa por [`permissions::can`].

pub mod devices;
pub mod invites;
pub mod permissions;
pub mod users;

use sqlx::FromRow;

/// Um membro do grupo.
#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct User {
    pub id: String,
    pub nick: String,
    pub is_owner: bool,
    pub created_at: i64,
    pub removed_at: Option<i64>,
}

impl User {
    pub fn is_active(&self) -> bool {
        self.removed_at.is_none()
    }
}
