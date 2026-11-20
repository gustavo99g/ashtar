//! Os atalhos globais (ADR 0029, decisões 5 a 8): funcionam com qualquer janela em foco, também
//! um jogo em tela cheia.
//!
//! Três partes:
//! - o gancho do Windows (`hook.rs`), numa thread própria com o laço de mensagens: só olha cada
//!   tecla e cada botão do mouse, manda para o canal e devolve a vez (nunca segura a tecla, e o jogo
//!   recebe tudo);
//! - a thread dos atalhos ([`worker`]), dona do [`Matcher`]: recebe do canal os eventos do gancho e
//!   os pedidos do app (a lista de atalhos, gravar ou não) e avisa o app;
//! - os comandos (`commands/shortcuts.rs`), que só põem o pedido no canal.
//!
//! O Rust só diz "apertou" e "soltou" com o nome do atalho; quem decide o que fazer é o app.

mod combo;
#[cfg(windows)]
mod hook;

use serde::Serialize;
use std::sync::mpsc::{self, Receiver, Sender};
use tauri::{AppHandle, Emitter};

pub use combo::Binding;
use combo::{Combo, Event, Input, Matcher, MouseButton};

/// Evento para o app: um atalho apertado ou solto (`{ id, pressed }`).
pub const SHORTCUT: &str = "shortcut";
/// Evento para o app, gravando: a combinação apertada e o nome dela (`{ combo, label }`).
pub const SHORTCUT_RECORDED: &str = "shortcut-recorded";

/// O que chega à thread dos atalhos.
pub enum Message {
    Input(Input, bool),
    Set(Vec<Binding>),
    Record(bool),
}

/// O estado gerenciado: o canal da thread dos atalhos.
pub struct Shortcuts {
    sender: Sender<Message>,
}

impl Shortcuts {
    pub fn send(&self, message: Message) {
        // A thread só termina com o app.
        let _ = self.sender.send(message);
    }
}

/// Liga a thread dos atalhos e o gancho. Fora do Windows, só a thread (os atalhos não disparam).
pub fn start(app: &AppHandle) -> Shortcuts {
    let (sender, receiver) = mpsc::channel();
    let handle = app.clone();
    if let Err(error) = std::thread::Builder::new()
        .name("ashtar-atalhos".into())
        .spawn(move || worker(&handle, receiver))
    {
        tracing::error!(%error, "não foi possível ligar a thread dos atalhos");
    }
    #[cfg(windows)]
    hook::install(sender.clone());
    Shortcuts { sender }
}

#[derive(Serialize, Clone)]
struct ShortcutPayload<'a> {
    id: &'a str,
    pressed: bool,
}

#[derive(Serialize, Clone)]
struct RecordedPayload {
    combo: Combo,
    label: String,
}

fn worker(app: &AppHandle, receiver: Receiver<Message>) {
    let mut matcher = Matcher::default();
    for message in receiver {
        let events = match message {
            Message::Input(input, down) => {
                let mut events = Vec::new();
                if down {
                    // Uma tecla que o Windows não avisou que soltou (a tela de bloqueio, o
                    // Ctrl+Alt+Del) não pode deixar um modificador preso para sempre.
                    let stale: Vec<u16> = matcher
                        .held_keys()
                        .filter(|key| !is_key_down(*key))
                        .collect();
                    for key in stale {
                        events.extend(matcher.forget(Input::Key(key)));
                    }
                }
                events.extend(matcher.event(input, down));
                events
            }
            Message::Set(bindings) => {
                tracing::info!(atalhos = bindings.len(), "atalhos atualizados");
                matcher.set_bindings(bindings)
            }
            Message::Record(recording) => matcher.set_recording(recording),
        };
        for event in events {
            let result = match &event {
                Event::Pressed(id) => app.emit(SHORTCUT, ShortcutPayload { id, pressed: true }),
                Event::Released(id) => app.emit(SHORTCUT, ShortcutPayload { id, pressed: false }),
                Event::Recorded(combo) => app.emit(
                    SHORTCUT_RECORDED,
                    RecordedPayload {
                        combo: *combo,
                        label: label(combo),
                    },
                ),
            };
            if let Err(error) = result {
                tracing::warn!(%error, "não foi possível avisar o app de um atalho");
            }
        }
    }
}

/// O nome da combinação, como o app mostra: `Ctrl+Shift+M`, `Mouse 4`.
fn label(combo: &Combo) -> String {
    let mut parts: Vec<String> = Vec::new();
    let modifiers = combo.modifiers;
    for (on, name) in [
        (modifiers.ctrl, "Ctrl"),
        (modifiers.shift, "Shift"),
        (modifiers.alt, "Alt"),
        (modifiers.win, "Win"),
    ] {
        if on {
            parts.push(name.into());
        }
    }
    match (combo.key, combo.mouse) {
        (Some(key), _) => parts.push(key_name(key)),
        (None, Some(MouseButton::Middle)) => parts.push("Botão do meio".into()),
        (None, Some(MouseButton::X1)) => parts.push("Mouse 4".into()),
        (None, Some(MouseButton::X2)) => parts.push("Mouse 5".into()),
        (None, None) => {}
    }
    parts.join("+")
}

#[cfg(windows)]
use hook::{is_key_down, key_name};

#[cfg(not(windows))]
fn is_key_down(_key: u16) -> bool {
    true
}

#[cfg(not(windows))]
fn key_name(key: u16) -> String {
    match key {
        0x30..=0x39 | 0x41..=0x5A => char::from(key as u8).to_string(),
        _ => format!("Tecla {key}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use combo::Modifiers;

    #[test]
    fn o_nome_da_combinacao_poe_os_modificadores_na_ordem_de_sempre() {
        let combo = Combo {
            modifiers: Modifiers {
                shift: true,
                ctrl: true,
                ..Modifiers::default()
            },
            key: Some(0x4D),
            mouse: None,
        };
        assert_eq!(label(&combo), "Ctrl+Shift+M");
        let mouse = Combo {
            modifiers: Modifiers::default(),
            key: None,
            mouse: Some(MouseButton::X1),
        };
        assert_eq!(label(&mouse), "Mouse 4");
    }
}
