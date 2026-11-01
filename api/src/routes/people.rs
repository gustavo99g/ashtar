//! `GET /api/people`: quem está no grupo, para a coluna de membros do chat.
//!
//! Diferente do `GET /api/members` do Painel, que é só de quem administra:
//! aqui vai só o que todo membro pode ver.

use axum::Json;
use axum::extract::State;
use serde::Serialize;
use ts_rs::TS;

use super::auth::CurrentUser;
use crate::AppState;
use crate::error::ApiError;
use crate::identity::users;

/// Um membro ativo, como a coluna de membros mostra.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "index.ts")]
pub struct Person {
    pub id: String,
    pub nick: String,
    pub display_name: Option<String>,
    pub is_owner: bool,
}

/// Os membros ativos, do mais antigo para o mais novo.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
) -> Result<Json<Vec<Person>>, ApiError> {
    let people = users::list(&state.db)
        .await?
        .into_iter()
        .filter(|user| user.is_active())
        .map(|user| Person {
            id: user.id,
            nick: user.nick,
            display_name: user.display_name,
            is_owner: user.is_owner,
        })
        .collect();
    Ok(Json(people))
}
