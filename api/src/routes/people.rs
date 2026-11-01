//! `GET /api/people`: quem está no grupo, para a coluna de membros do chat.
//!
//! Diferente do `GET /api/members` do Painel, que é só de quem administra:
//! aqui vai só o que todo membro pode ver, mais quem está online.

use axum::Json;
use axum::extract::State;

use super::auth::CurrentUser;
use crate::AppState;
use crate::error::ApiError;
use crate::identity::users::{self, Person};

/// Os membros ativos, do mais antigo para o mais novo.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
) -> Result<Json<Vec<Person>>, ApiError> {
    let people = users::list(&state.db)
        .await?
        .into_iter()
        .filter(|user| user.is_active())
        .map(|user| Person::new(&user, state.hub.is_online(&user.id)))
        .collect();
    Ok(Json(people))
}
