//! Os atalhos globais (`shortcuts/`): o app manda a lista e liga ou desliga a gravação.

use crate::error::AppError;
use crate::shortcuts::{Binding, Message, Shortcuts};
use tauri::State;

/// Troca a lista de atalhos que o gancho ouve. Mandada ao abrir o app e a cada mudança.
#[tauri::command]
pub async fn shortcuts_set(
    shortcuts: State<'_, Shortcuts>,
    bindings: Vec<Binding>,
) -> Result<(), AppError> {
    shortcuts.send(Message::Set(bindings));
    Ok(())
}

/// Gravando, nenhum atalho dispara: cada combinação apertada vai para o app (`shortcut-recorded`).
#[tauri::command]
pub async fn shortcuts_record(
    shortcuts: State<'_, Shortcuts>,
    recording: bool,
) -> Result<(), AppError> {
    shortcuts.send(Message::Record(recording));
    Ok(())
}
