//! Os atalhos globais (`shortcuts/`): o app manda a lista e liga ou desliga a gravação.

use crate::error::AppError;
use crate::shortcuts::{Binding, Input, Message, MouseButton, Shortcuts};
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

/// Uma tecla ou um botão que a janela do Ashtar viu, em foco (o gancho não vê): `key` pelo código
/// virtual do Windows, ou `mouse`. Entra no mesmo caminho do gancho.
#[tauri::command]
pub async fn shortcuts_input(
    shortcuts: State<'_, Shortcuts>,
    key: Option<u16>,
    mouse: Option<MouseButton>,
    down: bool,
) -> Result<(), AppError> {
    let input = match (key, mouse) {
        (Some(key), _) => Input::Key(key),
        (None, Some(button)) => Input::Mouse(button),
        (None, None) => return Ok(()),
    };
    shortcuts.send(Message::WindowInput(input, down));
    Ok(())
}
