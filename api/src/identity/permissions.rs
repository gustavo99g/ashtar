//! Quem pode o quê.
//!
//! Duas ideias separadas:
//!
//! - [`Permission`]: uma permissão que se dá a um usuário e fica guardada no
//!   banco (`user_permissions`). Hoje só existe o beta.
//! - [`Action`]: uma ação de administração. Quem decide se alguém pode fazê-la
//!   é [`can`], e só ela. Hoje a resposta é "só o dono"; quando os cargos
//!   chegarem, muda o miolo de `can` e o resto do código continua igual.

use sqlx::SqlitePool;

use super::User;
use crate::error::ApiError;

/// Permissão guardada por usuário. A chave em texto é o que vai para o banco
/// e para o `/api/me`; não mude uma chave que já existe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Permission {
    /// Recebe as versões do canal beta.
    BetaUpdates,
}

impl Permission {
    pub const ALL: [Permission; 1] = [Permission::BetaUpdates];

    pub fn key(self) -> &'static str {
        match self {
            Self::BetaUpdates => "atualizacoes.beta",
        }
    }

    /// `None` para uma chave que esta versão do código não conhece.
    pub fn from_key(key: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|p| p.key() == key)
    }
}

/// Ação de administração.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    CreateInvite,
    CreateRecoveryInvite,
    RevokeInvite,
    UnlinkDevice,
    RemoveMember,
    ManagePermissions,
}

/// O único lugar que decide se `user` pode fazer `action`.
pub fn can(user: &User, action: Action) -> bool {
    if !user.is_active() {
        return false;
    }
    match action {
        // Por enquanto, toda ação de administração é só do dono.
        Action::CreateInvite
        | Action::CreateRecoveryInvite
        | Action::RevokeInvite
        | Action::UnlinkDevice
        | Action::RemoveMember
        | Action::ManagePermissions => user.is_owner,
    }
}

/// `Err(Forbidden)` se `user` não pode fazer `action`.
pub fn require(user: &User, action: Action) -> Result<(), ApiError> {
    if can(user, action) {
        Ok(())
    } else {
        Err(ApiError::Forbidden)
    }
}

/// De onde vem uma permissão (para o `admin permissoes`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    /// O dono tem todas.
    Owner,
    /// Dada direto ao usuário.
    Direct,
}

/// As permissões que `user` tem de fato, com a origem de cada uma.
pub async fn effective(
    db: &SqlitePool,
    user: &User,
) -> Result<Vec<(Permission, Origin)>, ApiError> {
    if user.is_owner {
        return Ok(Permission::ALL
            .into_iter()
            .map(|p| (p, Origin::Owner))
            .collect());
    }

    let keys: Vec<String> =
        sqlx::query_scalar("SELECT permission FROM user_permissions WHERE user_id = ?")
            .bind(&user.id)
            .fetch_all(db)
            .await?;

    // Uma chave desconhecida (de uma versão futura, por exemplo) é ignorada.
    Ok(keys
        .iter()
        .filter_map(|key| Permission::from_key(key))
        .map(|p| (p, Origin::Direct))
        .collect())
}

/// Se `user` tem `permission`.
pub async fn has(db: &SqlitePool, user: &User, permission: Permission) -> Result<bool, ApiError> {
    Ok(effective(db, user)
        .await?
        .iter()
        .any(|(p, _)| *p == permission))
}

/// Dá (`granted = true`) ou tira uma permissão direta. Repetir não é erro.
pub async fn set(
    db: &SqlitePool,
    actor: &User,
    target: &User,
    permission: Permission,
    granted: bool,
    now: i64,
) -> Result<(), ApiError> {
    require(actor, Action::ManagePermissions)?;

    if granted {
        sqlx::query(
            "INSERT INTO user_permissions (user_id, permission, granted_at) VALUES (?, ?, ?)
             ON CONFLICT (user_id, permission) DO NOTHING",
        )
        .bind(&target.id)
        .bind(permission.key())
        .bind(now)
        .execute(db)
        .await?;
    } else {
        sqlx::query("DELETE FROM user_permissions WHERE user_id = ? AND permission = ?")
            .bind(&target.id)
            .bind(permission.key())
            .execute(db)
            .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(is_owner: bool, removed: bool) -> User {
        User {
            id: "u".into(),
            nick: "n".into(),
            is_owner,
            created_at: 0,
            removed_at: removed.then_some(1),
        }
    }

    #[test]
    fn dono_pode_tudo_e_membro_nada() {
        assert!(can(&user(true, false), Action::CreateInvite));
        assert!(can(&user(true, false), Action::RemoveMember));
        assert!(!can(&user(false, false), Action::CreateInvite));
    }

    #[test]
    fn removido_nao_pode_nada() {
        assert!(!can(&user(true, true), Action::CreateInvite));
    }

    #[test]
    fn chave_ida_e_volta() {
        for p in Permission::ALL {
            assert_eq!(Permission::from_key(p.key()), Some(p));
        }
        assert_eq!(Permission::from_key("nao.existe"), None);
    }
}
