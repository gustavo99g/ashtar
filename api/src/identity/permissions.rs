//! Quem pode o quê.
//!
//! Duas ideias separadas:
//!
//! - [`Permission`]: uma permissão que se dá a um usuário e fica guardada no
//!   banco (`user_permissions`). Hoje só existe o beta.
//! - [`Action`]: uma ação de administração. Quem decide se alguém pode fazê-la
//!   é [`can`], e só ela. Hoje a resposta é "só o dono"; quando os cargos
//!   chegarem, muda o miolo de `can` e o resto do código continua igual.
//!
//! [`overview`] junta as duas numa lista só, com o nome de cada uma em
//! português: é o que a gaveta do membro no Painel mostra.

use serde::Serialize;
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

    /// O nome que a tela mostra.
    pub fn label(self) -> &'static str {
        match self {
            Self::BetaUpdates => "Receber o beta",
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
    ViewPanel,
}

impl Action {
    /// Na ordem em que a gaveta do membro mostra.
    pub const ALL: [Action; 7] = [
        Action::CreateInvite,
        Action::CreateRecoveryInvite,
        Action::RevokeInvite,
        Action::UnlinkDevice,
        Action::RemoveMember,
        Action::ManagePermissions,
        Action::ViewPanel,
    ];

    /// Chave estável para o app (não vai para o banco).
    pub fn key(self) -> &'static str {
        match self {
            Self::CreateInvite => "convites.criar",
            Self::CreateRecoveryInvite => "convites.recuperacao",
            Self::RevokeInvite => "convites.revogar",
            Self::UnlinkDevice => "membros.desvincular",
            Self::RemoveMember => "membros.remover",
            Self::ManagePermissions => "permissoes.gerenciar",
            Self::ViewPanel => "painel.ver",
        }
    }

    /// O nome que a tela mostra.
    pub fn label(self) -> &'static str {
        match self {
            Self::CreateInvite => "Criar convites",
            Self::CreateRecoveryInvite => "Criar convites de recuperação",
            Self::RevokeInvite => "Revogar convites",
            Self::UnlinkDevice => "Desvincular computadores",
            Self::RemoveMember => "Remover membros",
            Self::ManagePermissions => "Gerenciar permissões",
            Self::ViewPanel => "Ver o Painel de controle",
        }
    }
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
        | Action::ManagePermissions
        | Action::ViewPanel => user.is_owner,
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

/// De onde vem uma permissão (para o `admin permissoes` e o Painel).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
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
///
/// O dono já tem todas, e quem foi removido não recebe nenhuma: os dois dão
/// `Conflict`, em vez de gravar uma linha que não muda nada.
pub async fn set(
    db: &SqlitePool,
    actor: &User,
    target: &User,
    permission: Permission,
    granted: bool,
    now: i64,
) -> Result<(), ApiError> {
    require(actor, Action::ManagePermissions)?;

    if target.is_owner {
        return Err(ApiError::Conflict(
            "O dono sempre tem todas as permissões.".into(),
        ));
    }
    if !target.is_active() {
        return Err(ApiError::Conflict("Esse membro foi removido.".into()));
    }

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

/// Se a linha é uma [`Permission`] (o dono pode ligar e desligar) ou uma
/// [`Action`] (hoje, só do dono).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GrantKind {
    Permission,
    Action,
}

/// Uma linha da lista de permissões de um membro.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Grant {
    pub key: &'static str,
    pub kind: GrantKind,
    pub label: &'static str,
    /// `None` quando o membro não tem.
    pub origin: Option<Origin>,
    /// Quando o dono ligou (só nas permissões dadas direto).
    pub granted_at: Option<i64>,
}

/// Todas as permissões e ações, na ordem da tela, com o que `user` tem e de
/// onde vem. Quem foi removido não tem nenhuma.
pub async fn overview(db: &SqlitePool, user: &User) -> Result<Vec<Grant>, ApiError> {
    let direct: Vec<(String, i64)> =
        sqlx::query_as("SELECT permission, granted_at FROM user_permissions WHERE user_id = ?")
            .bind(&user.id)
            .fetch_all(db)
            .await?;

    let permissions = Permission::ALL.into_iter().map(|permission| {
        let granted_at = direct
            .iter()
            .find(|(key, _)| key == permission.key())
            .map(|(_, at)| *at);
        let origin = if !user.is_active() {
            None
        } else if user.is_owner {
            Some(Origin::Owner)
        } else {
            granted_at.map(|_| Origin::Direct)
        };
        Grant {
            key: permission.key(),
            kind: GrantKind::Permission,
            label: permission.label(),
            granted_at: granted_at.filter(|_| origin == Some(Origin::Direct)),
            origin,
        }
    });
    // Hoje quem pode uma ação é só o dono, então a origem é sempre `Owner`.
    let actions = Action::ALL.into_iter().map(|action| Grant {
        key: action.key(),
        kind: GrantKind::Action,
        label: action.label(),
        origin: can(user, action).then_some(Origin::Owner),
        granted_at: None,
    });
    Ok(permissions.chain(actions).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(is_owner: bool, removed: bool) -> User {
        User {
            id: "u".into(),
            nick: "n".into(),
            display_name: None,
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
    fn toda_acao_tem_chave_e_nome_proprios() {
        let mut keys: Vec<&str> = Action::ALL.iter().map(|a| a.key()).collect();
        keys.extend(Permission::ALL.iter().map(|p| p.key()));
        let total = keys.len();
        keys.sort();
        keys.dedup();
        assert_eq!(keys.len(), total);
        assert!(Action::ALL.iter().all(|a| !a.label().is_empty()));
    }

    #[test]
    fn removido_nao_pode_nada() {
        assert!(!can(&user(true, true), Action::CreateInvite));
        assert!(!can(&user(true, true), Action::ViewPanel));
        assert!(can(&user(true, false), Action::ViewPanel));
        assert!(!can(&user(false, false), Action::CreateInvite));
        assert!(!can(&user(false, false), Action::ViewPanel));
    }

    #[test]
    fn chave_ida_e_volta() {
        for p in Permission::ALL {
            assert_eq!(Permission::from_key(p.key()), Some(p));
        }
        assert_eq!(Permission::from_key("nao.existe"), None);
    }
}
