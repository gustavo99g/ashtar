//! As combinações dos atalhos e o casamento com o que está apertado (ADR 0029, decisões 5 a 7).
//!
//! Puro, sem o Windows: o gancho (`hook.rs`) só traduz cada evento em [`Input`] e entrega ao
//! [`Matcher`], que diz qual atalho foi apertado ou solto, ou, gravando, qual combinação saiu.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Os botões do mouse que podem ser atalho. O esquerdo e o direito não podem (decisão 6).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MouseButton {
    Middle,
    X1,
    X2,
}

/// Uma tecla (pelo código virtual do Windows, `VK_*`) ou um botão do mouse.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Input {
    Key(u16),
    Mouse(MouseButton),
}

/// Os modificadores, em qualquer ordem.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Modifiers {
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
    pub win: bool,
}

impl Modifiers {
    fn is_empty(self) -> bool {
        self == Self::default()
    }

    /// Todos os de `self` estão em `held`.
    fn within(self, held: Self) -> bool {
        (!self.ctrl || held.ctrl)
            && (!self.shift || held.shift)
            && (!self.alt || held.alt)
            && (!self.win || held.win)
    }
}

/// Uma combinação: até quatro modificadores e uma tecla ou um botão do mouse. A tecla pode ser
/// um modificador: o Ctrl sozinho é atalho, e `Ctrl+Shift` é o Ctrl mais a tecla Shift. No app
/// (JSON), o mesmo formato: `{ ctrl, shift, alt, win, key: 77 | null, mouse: "x1" | null }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Combo {
    #[serde(flatten)]
    pub modifiers: Modifiers,
    pub key: Option<u16>,
    pub mouse: Option<MouseButton>,
}

impl Combo {
    pub fn input(&self) -> Option<Input> {
        match (self.key, self.mouse) {
            (Some(key), None) => Some(Input::Key(key)),
            (None, Some(button)) => Some(Input::Mouse(button)),
            _ => None,
        }
    }

    fn of(modifiers: Modifiers, input: Input) -> Self {
        match input {
            Input::Key(key) => Self {
                modifiers,
                key: Some(key),
                mouse: None,
            },
            Input::Mouse(button) => Self {
                modifiers,
                key: None,
                mouse: Some(button),
            },
        }
    }
}

/// Um atalho que o app quer ouvir: o nome (`mute`, `ptt`...) e a combinação.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Binding {
    pub id: String,
    pub combo: Combo,
}

/// O que o [`Matcher`] devolve para o app.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Pressed(String),
    Released(String),
    Recorded(Combo),
}

pub const VK_SHIFT: u16 = 0x10;
pub const VK_CONTROL: u16 = 0x11;
pub const VK_MENU: u16 = 0x12;
pub const VK_LWIN: u16 = 0x5B;
pub const VK_RWIN: u16 = 0x5C;
pub const VK_LSHIFT: u16 = 0xA0;
pub const VK_RSHIFT: u16 = 0xA1;
pub const VK_LCONTROL: u16 = 0xA2;
pub const VK_RCONTROL: u16 = 0xA3;
pub const VK_LMENU: u16 = 0xA4;
pub const VK_RMENU: u16 = 0xA5;

pub fn is_modifier(vk: u16) -> bool {
    matches!(
        vk,
        VK_SHIFT
            | VK_CONTROL
            | VK_MENU
            | VK_LWIN
            | VK_RWIN
            | VK_LSHIFT
            | VK_RSHIFT
            | VK_LCONTROL
            | VK_RCONTROL
            | VK_LMENU
            | VK_RMENU
    )
}

/// Decide, evento a evento, que atalho foi apertado ou solto.
///
/// - A repetição do teclado (a tecla segurada manda vários "apertou") conta uma vez.
/// - Um atalho com modificadores pede exatamente aqueles: `Ctrl+M` não dispara com `Ctrl+Shift+M`.
///   Um atalho sem modificador (o `V` do pressionar para falar, um botão lateral) dispara com
///   qualquer modificador apertado: no jogo, a pessoa corre com o Shift e fala ao mesmo tempo.
/// - Soltar qualquer tecla da combinação solta o atalho.
/// - Gravando, nenhum atalho dispara: a pessoa aperta o que quiser e a gravação fecha quando ela
///   solta a primeira tecla. Uma tecla sozinha (até o Ctrl) é o atalho; com mais de uma, os
///   modificadores ficam como modificadores e a última tecla comum (ou o último modificador, se só
///   houver modificadores) é a tecla.
#[derive(Debug, Default)]
pub struct Matcher {
    held: HashSet<Input>,
    bindings: Vec<Binding>,
    /// Os atalhos apertados agora.
    active: Vec<Binding>,
    recording: bool,
    /// Gravando: a última tecla comum ou botão apertado, e o último modificador.
    record_main: Option<Input>,
    record_modifier: Option<u16>,
}

impl Matcher {
    /// Troca a lista de atalhos. Quem estava apertado e saiu da lista (ou mudou) é solto.
    pub fn set_bindings(&mut self, bindings: Vec<Binding>) -> Vec<Event> {
        let released = self.release_where(|binding| !bindings.contains(binding));
        self.bindings = bindings;
        released
    }

    /// Liga ou desliga a gravação. Ligar solta o que estava apertado.
    pub fn set_recording(&mut self, recording: bool) -> Vec<Event> {
        self.recording = recording;
        self.record_main = None;
        self.record_modifier = None;
        if recording {
            self.release_where(|_| true)
        } else {
            Vec::new()
        }
    }

    /// Esquece uma tecla que o Windows não avisou que soltou (a tela de bloqueio, o Ctrl+Alt+Del).
    pub fn forget(&mut self, input: Input) -> Vec<Event> {
        self.up(input)
    }

    pub fn held_keys(&self) -> impl Iterator<Item = u16> + '_ {
        self.held.iter().filter_map(|input| match input {
            Input::Key(key) => Some(*key),
            Input::Mouse(_) => None,
        })
    }

    pub fn event(&mut self, input: Input, down: bool) -> Vec<Event> {
        if down {
            self.down(input)
        } else {
            self.up(input)
        }
    }

    fn modifiers(&self) -> Modifiers {
        self.modifiers_except(None)
    }

    /// Os modificadores apertados, sem contar `input` (a tecla do próprio atalho, quando ela é um
    /// modificador: o Ctrl sozinho não é "Ctrl com Ctrl").
    fn modifiers_except(&self, input: Option<Input>) -> Modifiers {
        let has = |keys: &[u16]| {
            keys.iter().any(|key| {
                let key = Input::Key(*key);
                Some(key) != input && self.held.contains(&key)
            })
        };
        Modifiers {
            ctrl: has(&[VK_CONTROL, VK_LCONTROL, VK_RCONTROL]),
            shift: has(&[VK_SHIFT, VK_LSHIFT, VK_RSHIFT]),
            alt: has(&[VK_MENU, VK_LMENU, VK_RMENU]),
            win: has(&[VK_LWIN, VK_RWIN]),
        }
    }

    fn down(&mut self, input: Input) -> Vec<Event> {
        // A repetição do teclado.
        if !self.held.insert(input) {
            return Vec::new();
        }
        if self.recording {
            match input {
                Input::Key(key) if is_modifier(key) => self.record_modifier = Some(key),
                _ => self.record_main = Some(input),
            }
            return Vec::new();
        }
        // O atalho que a tecla completa: a tecla dele é esta, ou ela é um dos modificadores dele
        // (o `Ctrl+Shift` dispara no Shift ou no Ctrl, o que vier por último).
        let exact: Vec<Binding> = self
            .bindings
            .iter()
            .filter(|binding| {
                let Some(own) = binding.combo.input() else {
                    return false;
                };
                let completes = own == input || {
                    let Input::Key(key) = input else {
                        return false;
                    };
                    let Input::Key(own_key) = own else {
                        return false;
                    };
                    is_modifier(own_key) && is_modifier(key) && self.held.contains(&own)
                };
                completes && binding.combo.modifiers == self.modifiers_except(Some(own))
            })
            .cloned()
            .collect();
        let matched = if exact.is_empty() {
            self.bindings
                .iter()
                .filter(|binding| {
                    binding.combo.input() == Some(input) && binding.combo.modifiers.is_empty()
                })
                .cloned()
                .collect()
        } else {
            exact
        };
        let mut events = Vec::new();
        for binding in matched {
            if !self.active.iter().any(|active| active.id == binding.id) {
                events.push(Event::Pressed(binding.id.clone()));
                self.active.push(binding);
            }
        }
        events
    }

    fn up(&mut self, input: Input) -> Vec<Event> {
        if self.recording && self.held.contains(&input) {
            let combo = match (self.record_main, self.record_modifier) {
                (Some(main), _) => Some(Combo::of(self.modifiers(), main)),
                (None, Some(key)) => Some(Combo::of(
                    self.modifiers_except(Some(Input::Key(key))),
                    Input::Key(key),
                )),
                (None, None) => None,
            };
            self.held.remove(&input);
            self.record_main = None;
            self.record_modifier = None;
            return combo.map(Event::Recorded).into_iter().collect();
        }
        if !self.held.remove(&input) {
            return Vec::new();
        }
        let modifiers = self.modifiers();
        self.release_where(|binding| {
            binding.combo.input() == Some(input) || !binding.combo.modifiers.within(modifiers)
        })
    }

    fn release_where(&mut self, release: impl Fn(&Binding) -> bool) -> Vec<Event> {
        let mut events = Vec::new();
        self.active.retain(|binding| {
            if release(binding) {
                events.push(Event::Released(binding.id.clone()));
                false
            } else {
                true
            }
        });
        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const M: u16 = 0x4D;
    const V: u16 = 0x56;

    fn combo(ctrl: bool, shift: bool, input: Input) -> Combo {
        Combo::of(
            Modifiers {
                ctrl,
                shift,
                ..Modifiers::default()
            },
            input,
        )
    }

    fn matcher() -> Matcher {
        let mut matcher = Matcher::default();
        matcher.set_bindings(vec![
            Binding {
                id: "mute".into(),
                combo: combo(true, true, Input::Key(M)),
            },
            Binding {
                id: "ptt".into(),
                combo: combo(false, false, Input::Key(V)),
            },
            Binding {
                id: "deafen".into(),
                combo: combo(false, true, Input::Mouse(MouseButton::X1)),
            },
        ]);
        matcher
    }

    fn press(matcher: &mut Matcher, inputs: &[Input]) -> Vec<Event> {
        inputs
            .iter()
            .flat_map(|input| matcher.event(*input, true))
            .collect()
    }

    #[test]
    fn os_modificadores_em_qualquer_ordem_e_esquerdo_ou_direito() {
        let mut m = matcher();
        let events = press(
            &mut m,
            &[
                Input::Key(VK_LSHIFT),
                Input::Key(VK_RCONTROL),
                Input::Key(M),
            ],
        );
        assert_eq!(events, vec![Event::Pressed("mute".into())]);
    }

    #[test]
    fn com_um_modificador_a_mais_nao_dispara() {
        let mut m = matcher();
        let events = press(
            &mut m,
            &[
                Input::Key(VK_LCONTROL),
                Input::Key(VK_LSHIFT),
                Input::Key(VK_LMENU),
                Input::Key(M),
            ],
        );
        assert!(events.is_empty());
    }

    #[test]
    fn a_repeticao_do_teclado_conta_uma_vez() {
        let mut m = matcher();
        let events = press(&mut m, &[Input::Key(V), Input::Key(V), Input::Key(V)]);
        assert_eq!(events, vec![Event::Pressed("ptt".into())]);
        assert_eq!(
            m.event(Input::Key(V), false),
            vec![Event::Released("ptt".into())]
        );
    }

    #[test]
    fn sem_modificador_dispara_mesmo_correndo_com_o_shift() {
        let mut m = matcher();
        let events = press(&mut m, &[Input::Key(VK_LSHIFT), Input::Key(V)]);
        assert_eq!(events, vec![Event::Pressed("ptt".into())]);
        // Soltar o Shift não solta o V.
        assert!(m.event(Input::Key(VK_LSHIFT), false).is_empty());
    }

    #[test]
    fn soltar_qualquer_tecla_da_combinacao_solta_o_atalho() {
        let mut m = matcher();
        press(
            &mut m,
            &[
                Input::Key(VK_LCONTROL),
                Input::Key(VK_LSHIFT),
                Input::Key(M),
            ],
        );
        assert_eq!(
            m.event(Input::Key(VK_LCONTROL), false),
            vec![Event::Released("mute".into())]
        );
        // Soltar o resto não solta de novo.
        assert!(m.event(Input::Key(M), false).is_empty());
    }

    #[test]
    fn o_botao_do_mouse_com_e_sem_modificador() {
        let mut m = matcher();
        assert!(press(&mut m, &[Input::Mouse(MouseButton::X1)]).is_empty());
        m.event(Input::Mouse(MouseButton::X1), false);
        let events = press(
            &mut m,
            &[Input::Key(VK_LSHIFT), Input::Mouse(MouseButton::X1)],
        );
        assert_eq!(events, vec![Event::Pressed("deafen".into())]);
        assert_eq!(
            m.event(Input::Mouse(MouseButton::X1), false),
            vec![Event::Released("deafen".into())]
        );
    }

    #[test]
    fn gravando_nenhum_atalho_dispara_e_a_combinacao_sai_ao_soltar() {
        let mut m = matcher();
        m.set_recording(true);
        let events = press(
            &mut m,
            &[
                Input::Key(VK_LCONTROL),
                Input::Key(VK_LSHIFT),
                Input::Key(V),
            ],
        );
        assert!(events.is_empty());
        assert_eq!(
            m.event(Input::Key(V), false),
            vec![Event::Recorded(combo(true, true, Input::Key(V)))]
        );
        // Soltar o resto não grava de novo.
        assert!(m.event(Input::Key(VK_LCONTROL), false).is_empty());
        m.set_recording(false);
        m.event(Input::Key(VK_LSHIFT), false);
        assert_eq!(
            press(&mut m, &[Input::Key(V)]),
            vec![Event::Pressed("ptt".into())]
        );
    }

    #[test]
    fn gravar_solta_o_que_estava_apertado() {
        let mut m = matcher();
        press(&mut m, &[Input::Key(V)]);
        assert_eq!(m.set_recording(true), vec![Event::Released("ptt".into())]);
    }

    #[test]
    fn trocar_a_lista_solta_quem_saiu_dela() {
        let mut m = matcher();
        press(&mut m, &[Input::Key(V)]);
        assert_eq!(
            m.set_bindings(Vec::new()),
            vec![Event::Released("ptt".into())]
        );
    }

    #[test]
    fn a_combinacao_vem_do_app_em_json() {
        let combo: Combo = serde_json::from_str(
            r#"{"ctrl":true,"shift":true,"alt":false,"win":false,"key":77,"mouse":null}"#,
        )
        .unwrap();
        assert_eq!(combo.input(), Some(Input::Key(M)));
        let mouse: Combo = serde_json::from_str(
            r#"{"ctrl":false,"shift":false,"alt":false,"win":false,"key":null,"mouse":"x2"}"#,
        )
        .unwrap();
        assert_eq!(mouse.input(), Some(Input::Mouse(MouseButton::X2)));
    }

    #[test]
    fn gravando_uma_tecla_sozinha_e_o_atalho() {
        let mut m = matcher();
        m.set_recording(true);
        press(&mut m, &[Input::Key(VK_LCONTROL)]);
        assert_eq!(
            m.event(Input::Key(VK_LCONTROL), false),
            vec![Event::Recorded(combo(
                false,
                false,
                Input::Key(VK_LCONTROL)
            ))]
        );
        press(&mut m, &[Input::Key(V)]);
        assert_eq!(
            m.event(Input::Key(V), false),
            vec![Event::Recorded(combo(false, false, Input::Key(V)))]
        );
    }

    #[test]
    fn gravando_so_modificadores() {
        let mut m = matcher();
        m.set_recording(true);
        press(&mut m, &[Input::Key(VK_LCONTROL), Input::Key(VK_LSHIFT)]);
        assert_eq!(
            m.event(Input::Key(VK_LCONTROL), false),
            vec![Event::Recorded(combo(true, false, Input::Key(VK_LSHIFT)))]
        );
    }

    #[test]
    fn um_modificador_sozinho_e_atalho() {
        let mut m = Matcher::default();
        m.set_bindings(vec![Binding {
            id: "ptt".into(),
            combo: combo(false, false, Input::Key(VK_LCONTROL)),
        }]);
        assert_eq!(
            press(&mut m, &[Input::Key(VK_LCONTROL)]),
            vec![Event::Pressed("ptt".into())]
        );
        assert_eq!(
            m.event(Input::Key(VK_LCONTROL), false),
            vec![Event::Released("ptt".into())]
        );
        // Com o Shift apertado antes, também.
        assert_eq!(
            press(&mut m, &[Input::Key(VK_LSHIFT), Input::Key(VK_LCONTROL)]),
            vec![Event::Pressed("ptt".into())]
        );
    }

    #[test]
    fn so_modificadores_em_qualquer_ordem() {
        let mut m = Matcher::default();
        m.set_bindings(vec![Binding {
            id: "mute".into(),
            combo: combo(true, false, Input::Key(VK_LSHIFT)),
        }]);
        assert_eq!(
            press(&mut m, &[Input::Key(VK_LSHIFT), Input::Key(VK_LCONTROL)]),
            vec![Event::Pressed("mute".into())]
        );
        assert_eq!(
            m.event(Input::Key(VK_LCONTROL), false),
            vec![Event::Released("mute".into())]
        );
    }
}
