//! Convites: criar, usar, revogar e listar.
//!
//! Dois tipos:
//! - **novo**: cria um membro com o nick escolhido. Vale até expirar ou até
//!   `max_uses` pessoas entrarem com ele, o que vier primeiro: um convite de
//!   5 minutos e 8 usos serve para mandar no grupo; o padrão (1 uso) serve
//!   para mandar no privado;
//! - **recuperação**: aponta para um membro que já existe e troca o
//!   dispositivo dele pelo de quem usar o convite (placa-mãe nova, computador
//!   novo). Sempre de uso único.
//!
//! O convite novo guarda o modelo escolhido na tela ([`Preset`]): "Para uma
//! pessoa" e "Para o grupo" têm validade e usos fixos, definidos aqui; só "Do
//! seu jeito" recebe os números de quem cria.
//!
//! O código aparece uma vez só, na criação: o banco guarda o hash. O convite
//! nunca é apagado; ele e os seus usos (`invite_uses`) são o histórico de
//! quem convidou quem.

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqliteExecutor, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

use super::permissions::{Action, require};
use super::{User, devices, users};
use crate::error::{ApiError, InviteRefusal};
use crate::secret;

/// Validade padrão: 7 dias.
pub const DEFAULT_TTL_SECS: i64 = 7 * 24 * 60 * 60;

/// Validade mínima e máxima de um convite: de 1 minuto a 30 dias.
pub const MIN_TTL_SECS: i64 = 60;
pub const MAX_TTL_SECS: i64 = 30 * 24 * 60 * 60;

/// Limite de usos de um convite novo. Mais que isso é um convite aberto demais
/// para um grupo de 5 a 10 pessoas.
pub const MAX_USES_LIMIT: i64 = 50;

/// "Para uma pessoa": 7 dias, 1 uso. Para mandar no privado.
pub const PERSON_TTL_SECS: i64 = 7 * 24 * 60 * 60;
pub const PERSON_MAX_USES: i64 = 1;

/// "Para o grupo": 5 minutos, até 8 usos. Para mandar no grupo do WhatsApp.
pub const GROUP_TTL_SECS: i64 = 5 * 60;
pub const GROUP_MAX_USES: i64 = 8;

/// O modelo de um convite novo, como a tela mostra. A chave em texto vai para o
/// banco (`invites.preset`) e para o JSON; não mude uma que já existe.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
pub enum Preset {
    /// "Para uma pessoa".
    Person,
    /// "Para o grupo".
    Group,
    /// "Do seu jeito": validade e usos escolhidos por quem cria.
    Custom,
}

impl Preset {
    pub fn as_db(self) -> &'static str {
        match self {
            Self::Person => "person",
            Self::Group => "group",
            Self::Custom => "custom",
        }
    }

    /// `None` para um texto que não é modelo (ou o `NULL` da recuperação).
    pub fn from_db(value: &str) -> Option<Self> {
        [Self::Person, Self::Group, Self::Custom]
            .into_iter()
            .find(|p| p.as_db() == value)
    }

    /// O modelo que bate com esses números. É o que fica gravado quando ninguém
    /// escolheu modelo: os convites do `admin`.
    pub fn matching(ttl_secs: i64, max_uses: i64) -> Self {
        match (ttl_secs, max_uses) {
            (PERSON_TTL_SECS, PERSON_MAX_USES) => Self::Person,
            (GROUP_TTL_SECS, GROUP_MAX_USES) => Self::Group,
            _ => Self::Custom,
        }
    }
}

/// O pedido de um convite novo pela tela: um dos modelos fixos, ou "Do seu
/// jeito" com os números.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NewInvite {
    Person,
    Group,
    Custom { ttl_secs: i64, max_uses: i64 },
}

impl NewInvite {
    pub fn preset(self) -> Preset {
        match self {
            Self::Person => Preset::Person,
            Self::Group => Preset::Group,
            Self::Custom { .. } => Preset::Custom,
        }
    }

    /// Validade (em segundos) e usos.
    pub fn numbers(self) -> (i64, i64) {
        match self {
            Self::Person => (PERSON_TTL_SECS, PERSON_MAX_USES),
            Self::Group => (GROUP_TTL_SECS, GROUP_MAX_USES),
            Self::Custom { ttl_secs, max_uses } => (ttl_secs, max_uses),
        }
    }
}

/// Convite novo ou de recuperação.
// No histórico, o `kind` sai em texto do banco (`InviteView`); o `rename_all` dá ao
// TypeScript a mesma união, `"new" | "recovery"`. O cartão do convite (v0.9) manda o tipo
// direto, com o mesmo texto.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "index.ts", rename_all = "snake_case")]
pub enum InviteKind {
    New,
    Recovery,
}

impl InviteKind {
    fn as_db(self) -> &'static str {
        match self {
            Self::New => "new",
            Self::Recovery => "recovery",
        }
    }
}

/// Situação de um convite num instante.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
pub enum InviteStatus {
    /// Ainda aceita gente.
    Pending,
    /// Todos os usos foram gastos.
    Exhausted,
    Revoked,
    Expired,
}

/// Uma linha do histórico, já com os nicks e os nomes visíveis.
#[derive(Debug, Clone)]
pub struct InviteRecord {
    pub id: String,
    pub kind: String,
    /// `None` na recuperação.
    pub preset: Option<Preset>,
    pub target_id: Option<String>,
    pub target_nick: Option<String>,
    pub target_display_name: Option<String>,
    pub max_uses: i64,
    pub created_by_id: String,
    pub created_by_nick: String,
    pub created_by_display_name: Option<String>,
    pub created_at: i64,
    pub expires_at: i64,
    pub revoked_at: Option<i64>,
    /// Quem entrou com ele e quando, do primeiro para o último.
    pub uses: Vec<InviteUse>,
}

#[derive(Debug, Clone, FromRow)]
pub struct InviteUse {
    pub invite_id: String,
    pub user_id: String,
    pub nick: String,
    pub display_name: Option<String>,
    pub used_at: i64,
}

impl InviteRecord {
    pub fn status(&self, now: i64) -> InviteStatus {
        if self.uses.len() as i64 >= self.max_uses {
            InviteStatus::Exhausted
        } else if self.revoked_at.is_some() {
            InviteStatus::Revoked
        } else if self.expires_at <= now {
            InviteStatus::Expired
        } else {
            InviteStatus::Pending
        }
    }
}

/// Convite recém-criado: o código só existe aqui.
#[derive(Debug, Clone)]
pub struct CreatedInvite {
    pub id: String,
    pub code: String,
    pub expires_at: i64,
    pub max_uses: i64,
    pub preset: Option<Preset>,
}

/// Cria um convite. `target` é obrigatório na recuperação e proibido no novo.
/// `max_uses` vale só para o novo (de 1 a [`MAX_USES_LIMIT`]); a recuperação
/// é sempre de uso único.
///
/// É o caminho do `admin` e dos testes, que dão os números: o convite novo
/// grava o modelo que bate com eles ([`Preset::matching`]). A tela usa
/// [`create_new`], que grava o modelo escolhido.
pub async fn create(
    db: &SqlitePool,
    actor: &User,
    kind: InviteKind,
    target: Option<&User>,
    ttl_secs: i64,
    max_uses: i64,
    now: i64,
) -> Result<CreatedInvite, ApiError> {
    let preset = match kind {
        InviteKind::New => Some(Preset::matching(ttl_secs, max_uses)),
        InviteKind::Recovery => None,
    };
    insert(db, actor, kind, target, (ttl_secs, max_uses), preset, now).await
}

/// Cria um convite novo com o modelo escolhido na tela. Nos modelos fixos, a
/// validade e os usos s\ão os daqui; "Do seu jeito" guarda `custom` mesmo que os
/// n\úmeros sejam os de um modelo.
pub async fn create_new(
    db: &SqlitePool,
    actor: &User,
    invite: NewInvite,
    now: i64,
) -> Result<CreatedInvite, ApiError> {
    let preset = Some(invite.preset());
    insert(
        db,
        actor,
        InviteKind::New,
        None,
        invite.numbers(),
        preset,
        now,
    )
    .await
}

/// Confere e grava o convite. O par traz a validade (em segundos) e os usos.
async fn insert(
    db: &SqlitePool,
    actor: &User,
    kind: InviteKind,
    target: Option<&User>,
    (ttl_secs, max_uses): (i64, i64),
    preset: Option<Preset>,
    now: i64,
) -> Result<CreatedInvite, ApiError> {
    match kind {
        InviteKind::New => require(actor, Action::CreateInvite)?,
        InviteKind::Recovery => require(actor, Action::CreateRecoveryInvite)?,
    }
    if !(MIN_TTL_SECS..=MAX_TTL_SECS).contains(&ttl_secs) {
        return Err(ApiError::InvalidRequest(
            "A validade do convite vai de 1 minuto a 30 dias.".into(),
        ));
    }
    let (target_id, max_uses) = match (kind, target) {
        (InviteKind::New, None) if (1..=MAX_USES_LIMIT).contains(&max_uses) => (None, max_uses),
        (InviteKind::New, None) => {
            return Err(ApiError::InvalidRequest(format!(
                "O número de usos vai de 1 a {MAX_USES_LIMIT}."
            )));
        }
        (InviteKind::New, Some(_)) => {
            return Err(ApiError::InvalidRequest(
                "Um convite novo não aponta para um membro.".into(),
            ));
        }
        (InviteKind::Recovery, Some(user)) if user.is_active() => (Some(user.id.clone()), 1),
        (InviteKind::Recovery, Some(_)) => {
            return Err(ApiError::Conflict("Esse membro foi removido.".into()));
        }
        (InviteKind::Recovery, None) => {
            return Err(ApiError::InvalidRequest(
                "Um convite de recuperação precisa de um membro.".into(),
            ));
        }
    };

    // O `User` que chegou pode estar velho: confere no banco que o membro ainda está ativo.
    if let Some(target_id) = &target_id {
        let active: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM users WHERE id = ? AND removed_at IS NULL")
                .bind(target_id)
                .fetch_optional(db)
                .await?;
        if active.is_none() {
            return Err(ApiError::Conflict("Esse membro foi removido.".into()));
        }
    }

    let invite = CreatedInvite {
        id: Uuid::new_v4().to_string(),
        code: secret::new_invite_code(),
        expires_at: now + ttl_secs,
        max_uses,
        preset,
    };
    let normalized = secret::normalize_invite_code(&invite.code).expect("código gerado é válido");

    sqlx::query(
        "INSERT INTO invites
        (id, code_hash, kind, target_user_id, max_uses, created_by, created_at, expires_at, preset)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&invite.id)
    .bind(secret::hash(&normalized))
    .bind(kind.as_db())
    .bind(target_id)
    .bind(invite.max_uses)
    .bind(&actor.id)
    .bind(now)
    .bind(invite.expires_at)
    .bind(preset.map(Preset::as_db))
    .execute(db)
    .await?;
    Ok(invite)
}

/// O histórico completo, do mais novo para o mais antigo.
pub async fn list(db: &SqlitePool) -> Result<Vec<InviteRecord>, ApiError> {
    #[derive(FromRow)]
    struct Row {
        id: String,
        kind: String,
        preset: Option<String>,
        target_id: Option<String>,
        target_nick: Option<String>,
        target_display_name: Option<String>,
        max_uses: i64,
        created_by_id: String,
        created_by_nick: String,
        created_by_display_name: Option<String>,
        created_at: i64,
        expires_at: i64,
        revoked_at: Option<i64>,
    }

    let rows: Vec<Row> = sqlx::query_as(
        "SELECT i.id, i.kind, i.preset,
              t.id AS target_id, t.nick AS target_nick, t.display_name AS target_display_name,
              i.max_uses,
              c.id AS created_by_id, c.nick AS created_by_nick,
              c.display_name AS created_by_display_name,
                i.created_at, i.expires_at, i.revoked_at
         FROM invites i
         JOIN users c ON c.id = i.created_by
         LEFT JOIN users t ON t.id = i.target_user_id
         ORDER BY i.created_at DESC",
    )
    .fetch_all(db)
    .await?;

    let uses: Vec<InviteUse> = sqlx::query_as(
        "SELECT iu.invite_id, u.id AS user_id, u.nick, u.display_name, iu.used_at
         FROM invite_uses iu JOIN users u ON u.id = iu.user_id
         ORDER BY iu.used_at",
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| InviteRecord {
            uses: uses
                .iter()
                .filter(|u| u.invite_id == row.id)
                .cloned()
                .collect(),
            preset: row.preset.as_deref().and_then(Preset::from_db),
            id: row.id,
            kind: row.kind,
            target_id: row.target_id,
            target_nick: row.target_nick,
            target_display_name: row.target_display_name,
            max_uses: row.max_uses,
            created_by_id: row.created_by_id,
            created_by_nick: row.created_by_nick,
            created_by_display_name: row.created_by_display_name,
            created_at: row.created_at,
            expires_at: row.expires_at,
            revoked_at: row.revoked_at,
        })
        .collect())
}

/// O que o `revoke` precisa saber do convite: id, usos máximos, usos gastos,
/// quando foi revogado e quando vence.
type RevokeRow = (String, i64, i64, Option<i64>, i64);

/// Revoga um convite pelo id ou pelo começo dele (no mínimo 4 caracteres,
/// como o `admin convites` mostra). Quem já entrou com ele continua membro;
/// ninguém mais entra.
pub async fn revoke(
    db: &SqlitePool,
    actor: &User,
    id_prefix: &str,
    now: i64,
) -> Result<(), ApiError> {
    require(actor, Action::RevokeInvite)?;
    if id_prefix.len() < 4 {
        return Err(ApiError::InvalidRequest(
            "Informe pelo menos 4 caracteres do id.".into(),
        ));
    }

    let matches: Vec<RevokeRow> = sqlx::query_as(
        "SELECT i.id, i.max_uses,
                (SELECT COUNT(*) FROM invite_uses iu WHERE iu.invite_id = i.id),
                i.revoked_at, i.expires_at
         FROM invites i WHERE substr(i.id, 1, length(?1)) = ?1",
    )
    .bind(id_prefix)
    .fetch_all(db)
    .await?;

    let found = match matches.as_slice() {
        [] => return Err(ApiError::NotFound("Nenhum convite com esse id.".into())),
        [one] => one.clone(),
        _ => {
            return Err(ApiError::Conflict(
                "Mais de um convite começa assim; use mais caracteres do id.".into(),
            ));
        }
    };
    revoke_found(db, found, now).await
}

/// Revoga um convite pelo id inteiro: o caminho do Painel. O começo do id
/// continua só no `admin`.
pub async fn revoke_by_id(
    db: &SqlitePool,
    actor: &User,
    id: &str,
    now: i64,
) -> Result<(), ApiError> {
    require(actor, Action::RevokeInvite)?;
    let found: Option<RevokeRow> = sqlx::query_as(
        "SELECT i.id, i.max_uses,
                    (SELECT COUNT(*) FROM invite_uses iu WHERE iu.invite_id = i.id),
                    i.revoked_at, i.expires_at
             FROM invites i WHERE i.id = ?",
    )
    .bind(id)
    .fetch_optional(db)
    .await?;
    let found = found.ok_or_else(|| ApiError::NotFound("Nenhum convite com esse id.".into()))?;
    revoke_found(db, found, now).await
}

/// Confere se o convite ainda pode ser revogado e revoga.
async fn revoke_found(db: &SqlitePool, found: RevokeRow, now: i64) -> Result<(), ApiError> {
    let (id, max_uses, uses, revoked_at, expires_at) = found;
    if uses >= max_uses {
        return Err(ApiError::Conflict(
            "Esse convite já foi usado por completo. Para desfazer, remova o membro.".into(),
        ));
    }
    if revoked_at.is_some() || expires_at <= now {
        return Err(ApiError::Conflict("Esse convite já não vale mais.".into()));
    }

    sqlx::query("UPDATE invites SET revoked_at = ? WHERE id = ?")
        .bind(now)
        .bind(&id)
        .execute(db)
        .await?;
    Ok(())
}

/// O resultado de usar um convite.
#[derive(Debug)]
pub struct Redeemed {
    pub user: User,
    /// O token da sessão aberta neste dispositivo.
    pub token: String,
    /// Se o convite criou um membro (convite novo) ou devolveu um que já
    /// existia (recuperação). Só o membro novo vira o `member.joined`.
    pub new_member: bool,
}

/// Usa um convite com a chave deste dispositivo.
///
/// - Convite novo: cria o membro com `nick` e vincula o dispositivo.
/// - Recuperação: `nick` é ignorado; o membro do convite passa a usar este
///   dispositivo, e o anterior (com a sessão dele) deixa de valer.
///
/// Devolve o membro, o token de sessão e se o membro é novo. Tudo numa
/// transação: se algo falhar, o uso não conta.
pub async fn redeem(
    db: &SqlitePool,
    code: &str,
    device_key: &str,
    nick: Option<&str>,
    now: i64,
) -> Result<Redeemed, ApiError> {
    let code = secret::normalize_invite_code(code)
        .ok_or(ApiError::InvalidInvite(InviteRefusal::NotFound))?;
    devices::validate_device_key(device_key)?;

    // IMMEDIATE: a transação já começa com a trava de escrita. Duas pessoas
    // usando o último lugar do convite ao mesmo tempo entram uma depois da
    // outra, e a segunda já vê o convite esgotado.
    let mut tx = db.begin_with("BEGIN IMMEDIATE").await?;

    let invite = find_valid(&mut *tx, &code, now).await?;

    if devices::key_in_use(&mut tx, device_key).await? {
        return Err(ApiError::DeviceAlreadyLinked);
    }

    let (user, new_member): (User, bool) = match (invite.kind.as_str(), invite.target_user_id) {
        ("recovery", Some(target_id)) => {
            let user: Option<User> = sqlx::query_as(
                "SELECT id, nick, is_owner, display_name, created_at, removed_at, avatar_id FROM users
                 WHERE id = ? AND removed_at IS NULL",
            )
            .bind(&target_id)
            .fetch_optional(&mut *tx)
            .await?;
            (
                user.ok_or(ApiError::InvalidInvite(InviteRefusal::Revoked))?,
                false,
            )
        }
        _ => {
            let nick = users::validate_nick(nick.unwrap_or_default())?;
            (users::insert(&mut tx, &nick, false, now).await?, true)
        }
    };

    let token = devices::link_and_open_session(&mut tx, &user.id, device_key, now).await?;

    sqlx::query("INSERT INTO invite_uses (invite_id, user_id, used_at) VALUES (?, ?, ?)")
        .bind(&invite.id)
        .bind(&user.id)
        .bind(now)
        .execute(&mut *tx)
        .await?;

    if new_member {
        // Quem entra vê o histórico sem números de não lidas (ADR 0022).
        crate::chat::read::seed_new_member(&mut tx, &user.id).await?;
        // "Enviar sons" vem ligada para todo mundo (ADR 0037).
        sqlx::query(
            "INSERT OR IGNORE INTO user_permissions (user_id, permission, granted_at)
             VALUES (?, ?, ?)",
        )
        .bind(&user.id)
        .bind(super::permissions::Permission::SendSounds.key())
        .bind(now)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(Redeemed {
        user,
        token,
        new_member,
    })
}

/// Um convite achado pelo código, valendo ou não.
#[derive(FromRow)]
struct FoundInvite {
    id: String,
    kind: String,
    target_user_id: Option<String>,
    created_by: String,
    expires_at: i64,
    revoked_at: Option<i64>,
    max_uses: i64,
    uses: i64,
}

impl FoundInvite {
    /// Se o convite ainda aceita gente agora, ou por que não. A ordem é a do
    /// [`InviteRecord::status`]: esgotado, revogado, vencido.
    fn check(&self, now: i64) -> Result<(), InviteRefusal> {
        if self.uses >= self.max_uses {
            Err(InviteRefusal::Used)
        } else if self.revoked_at.is_some() {
            Err(InviteRefusal::Revoked)
        } else if self.expires_at <= now {
            Err(InviteRefusal::Expired)
        } else {
            Ok(())
        }
    }
}

/// O convite com esse código (já normalizado), valendo ou não.
async fn find_by_code<'e>(
    executor: impl SqliteExecutor<'e>,
    code: &str,
) -> Result<Option<FoundInvite>, ApiError> {
    Ok(sqlx::query_as(
        "SELECT i.id, i.kind, i.target_user_id, i.created_by, i.expires_at, i.revoked_at, i.max_uses,
                (SELECT COUNT(*) FROM invite_uses iu WHERE iu.invite_id = i.id) AS uses
         FROM invites i WHERE i.code_hash = ?",
    )
    .bind(secret::hash(code))
    .fetch_optional(executor)
    .await?)
}

/// O convite com esse código (já normalizado), se ainda vale; senão, o
/// [`ApiError::InvalidInvite`] com o motivo. Usar, ler e o cartão do convite
/// passam por aqui, então nunca discordam do que é um convite válido.
async fn find_valid<'e>(
    executor: impl SqliteExecutor<'e>,
    code: &str,
    now: i64,
) -> Result<FoundInvite, ApiError> {
    let invite = find_by_code(executor, code)
        .await?
        .ok_or(ApiError::InvalidInvite(InviteRefusal::NotFound))?;
    invite.check(now).map_err(ApiError::InvalidInvite)?;
    Ok(invite)
}

/// O que se mostra de um convite antes de usá-lo.
#[derive(Debug, Clone)]
pub struct InvitePreview {
    pub kind: InviteKind,
    /// No convite novo, quem convidou; na recuperação, a conta que volta.
    pub person: User,
    pub expires_at: i64,
}

/// Lê um convite sem gastar nada: para a tela mostrar quem convidou (ou de quem
/// é a conta) antes do nick. Código inválido, vencido, revogado ou esgotado dá o
/// mesmo [`ApiError::InvalidInvite`] do [`redeem`], com o mesmo motivo.
pub async fn preview(db: &SqlitePool, code: &str, now: i64) -> Result<InvitePreview, ApiError> {
    let code = secret::normalize_invite_code(code)
        .ok_or(ApiError::InvalidInvite(InviteRefusal::NotFound))?;
    let invite = find_valid(db, &code, now).await?;

    let (kind, person_id) = match invite.target_user_id {
        Some(target) => (InviteKind::Recovery, target),
        None => (InviteKind::New, invite.created_by),
    };
    let person = users::find_by_id(db, &person_id)
        .await?
        .ok_or(ApiError::InvalidInvite(InviteRefusal::Revoked))?;
    // Como no `redeem`: a recuperação de quem foi removido não vale.
    if kind == InviteKind::Recovery && !person.is_active() {
        return Err(ApiError::InvalidInvite(InviteRefusal::Revoked));
    }
    Ok(InvitePreview {
        kind,
        person,
        expires_at: invite.expires_at,
    })
}

/// A situação de um convite para o cartão no chat (v0.9): o mesmo motivo da
/// recusa, ou `Pending` quando ainda vale.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "index.ts")]
pub enum InviteCardStatus {
    Pending,
    NotFound,
    Expired,
    Used,
    Revoked,
}

impl From<InviteRefusal> for InviteCardStatus {
    fn from(reason: InviteRefusal) -> Self {
        match reason {
            InviteRefusal::NotFound => Self::NotFound,
            InviteRefusal::Expired => Self::Expired,
            InviteRefusal::Used => Self::Used,
            InviteRefusal::Revoked => Self::Revoked,
        }
    }
}

/// O que o cartão do convite mostra. Sem `found` quando o código não existe.
#[derive(Debug, Clone)]
pub struct InviteCard {
    pub status: InviteCardStatus,
    /// O tipo, a pessoa (quem convidou, ou a conta na recuperação) e a validade.
    pub found: Option<(InviteKind, User, i64)>,
}

/// Lê um convite para o cartão no chat, valendo ou não. Só para quem já está no
/// grupo (a rota pede sessão), então não conta no limite de tentativas: quem vê um
/// convite velho no histórico não está adivinhando código. A conferência é a do
/// [`redeem`] e do [`preview`].
pub async fn card(db: &SqlitePool, code: &str, now: i64) -> Result<InviteCard, ApiError> {
    let not_found = InviteCard {
        status: InviteCardStatus::NotFound,
        found: None,
    };
    let Some(code) = secret::normalize_invite_code(code) else {
        return Ok(not_found);
    };
    let Some(invite) = find_by_code(db, &code).await? else {
        return Ok(not_found);
    };
    let (kind, person_id) = match &invite.target_user_id {
        Some(target) => (InviteKind::Recovery, target.clone()),
        None => (InviteKind::New, invite.created_by.clone()),
    };
    let Some(person) = users::find_by_id(db, &person_id).await? else {
        return Ok(not_found);
    };
    let status = match invite.check(now) {
        Err(reason) => reason.into(),
        // Como no `redeem`: a recuperação de quem foi removido não vale.
        Ok(()) if kind == InviteKind::Recovery && !person.is_active() => InviteCardStatus::Revoked,
        Ok(()) => InviteCardStatus::Pending,
    };
    Ok(InviteCard {
        status,
        found: Some((kind, person, invite.expires_at)),
    })
}
