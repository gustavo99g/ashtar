//! A bandeja do sistema: o Ashtar fica aberto em segundo plano.
//!
//! Fechar a janela (o X da barra de título, Alt + F4) não encerra o app: [`hide_on_close`] a
//! esconde, e o processo continua. A chamada de voz mora no WebView, então segue de pé, e quem
//! está na sala continua ouvindo e falando. Para voltar, o ícone da bandeja: um clique abre a
//! janela, e o menu tem "Abrir o Ashtar" e "Sair". Só o "Sair" encerra o app de verdade, e aí o
//! `lib.rs` grava o tamanho da janela e instala a atualização pendente, como antes.
//!
//! Se o ícone não puder ser criado, a janela volta a fechar normalmente ([`is_ready`]): esconder
//! sem ter por onde voltar deixaria o app preso, sem como abrir nem encerrar.
//!
//! Durante uma transmissão, o menu ganha "Abrir o painel da transmissão", "Pausar" (ou
//! "Continuar") e "Parar de transmitir" ([`set_share`]). Quem manda é o frontend, que tem o estado
//! da transmissão: o menu só repassa o clique como o evento [`TRAY_SHARE`].

use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, Runtime, Window, WindowEvent};

use crate::window::bring_to_front;

/// O ícone existe, então esconder a janela é seguro.
static READY: AtomicBool = AtomicBool::new(false);

const OPEN_ID: &str = "open";
const QUIT_ID: &str = "quit";
const SHARE_PANEL_ID: &str = "share-panel";
const SHARE_PAUSE_ID: &str = "share-pause";
const SHARE_RESUME_ID: &str = "share-resume";
const SHARE_STOP_ID: &str = "share-stop";

/// O evento de um clique nas opções da transmissão (contrato com o frontend).
pub const TRAY_SHARE: &str = "tray-share";

/// O que a pessoa pediu pela bandeja.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TrayShareAction {
    Panel,
    Pause,
    Resume,
    Stop,
}

impl TrayShareAction {
    fn from_id(id: &str) -> Option<Self> {
        match id {
            SHARE_PANEL_ID => Some(Self::Panel),
            SHARE_PAUSE_ID => Some(Self::Pause),
            SHARE_RESUME_ID => Some(Self::Resume),
            SHARE_STOP_ID => Some(Self::Stop),
            _ => None,
        }
    }
}

/// A transmissão como o menu mostra: `None` sem transmissão, `Some(paused)` com uma.
pub type TrayShare = Option<bool>;

/// Se o ícone da bandeja foi criado.
pub fn is_ready() -> bool {
    READY.load(Ordering::Acquire)
}

/// Cria o ícone da bandeja. Falhar só desliga o esconder ao fechar.
pub fn create(app: &App) {
    match build(app) {
        Ok(()) => {
            READY.store(true, Ordering::Release);
            tracing::info!("ícone da bandeja criado");
        }
        Err(error) => {
            tracing::warn!(%error, "não foi possível criar o ícone da bandeja; fechar a janela encerra o app");
        }
    }
}

/// O menu: as opções da transmissão (quando há uma), "Abrir o Ashtar" e "Sair".
fn menu<R: Runtime, M: Manager<R>>(manager: &M, share: TrayShare) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(manager)?;
    if let Some(paused) = share {
        let panel = MenuItem::with_id(
            manager,
            SHARE_PANEL_ID,
            "Abrir o painel da transmissão",
            true,
            None::<&str>,
        )?;
        let pause = if paused {
            MenuItem::with_id(
                manager,
                SHARE_RESUME_ID,
                "Continuar a transmissão",
                true,
                None::<&str>,
            )?
        } else {
            MenuItem::with_id(
                manager,
                SHARE_PAUSE_ID,
                "Pausar a transmissão",
                true,
                None::<&str>,
            )?
        };
        let stop = MenuItem::with_id(
            manager,
            SHARE_STOP_ID,
            "Parar de transmitir",
            true,
            None::<&str>,
        )?;
        menu.append_items(&[
            &panel,
            &pause,
            &stop,
            &PredefinedMenuItem::separator(manager)?,
        ])?;
    }
    let open = MenuItem::with_id(manager, OPEN_ID, "Abrir o Ashtar", true, None::<&str>)?;
    let quit = MenuItem::with_id(manager, QUIT_ID, "Sair", true, None::<&str>)?;
    menu.append_items(&[&open, &quit])?;
    Ok(menu)
}

/// Troca o menu e a dica do ícone conforme a transmissão. Sem ícone, não faz nada.
pub fn set_share(app: &AppHandle, share: TrayShare) {
    let Some(tray) = app.tray_by_id("main") else {
        return;
    };
    let tooltip = match share {
        None => "Ashtar",
        Some(false) => "Ashtar: transmitindo a tela",
        Some(true) => "Ashtar: transmissão pausada",
    };
    let result = menu(app, share).and_then(|menu| {
        tray.set_menu(Some(menu))?;
        tray.set_tooltip(Some(tooltip))
    });
    if let Err(error) = result {
        tracing::warn!(%error, "não foi possível trocar o menu da bandeja");
    }
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        OPEN_ID => bring_to_front(app),
        QUIT_ID => app.exit(0),
        _ => {
            let Some(action) = TrayShareAction::from_id(id) else {
                return;
            };
            if action == TrayShareAction::Panel {
                bring_to_front(app);
            }
            if let Err(error) = app.emit(TRAY_SHARE, action) {
                tracing::warn!(%error, "não foi possível avisar o frontend do clique na bandeja");
            }
        }
    }
}

fn build(app: &App) -> tauri::Result<()> {
    let menu = menu(app, None)?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Ashtar")
        .menu(&menu)
        // O clique esquerdo abre a janela; o menu vem no direito.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                bring_to_front(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Esconde a janela principal em vez de fechá-la, se o ícone da bandeja existe.
pub fn hide_on_close(window: &Window, event: &WindowEvent) {
    if window.label() != "main" || !is_ready() {
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        if let Err(error) = window.hide() {
            tracing::warn!(%error, "não foi possível esconder a janela");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cada_opcao_da_transmissao_vira_uma_acao() {
        assert_eq!(
            TrayShareAction::from_id(SHARE_PANEL_ID),
            Some(TrayShareAction::Panel)
        );
        assert_eq!(
            TrayShareAction::from_id(SHARE_PAUSE_ID),
            Some(TrayShareAction::Pause)
        );
        assert_eq!(
            TrayShareAction::from_id(SHARE_RESUME_ID),
            Some(TrayShareAction::Resume)
        );
        assert_eq!(
            TrayShareAction::from_id(SHARE_STOP_ID),
            Some(TrayShareAction::Stop)
        );
        assert_eq!(TrayShareAction::from_id(OPEN_ID), None);
        assert_eq!(
            serde_json::to_value(TrayShareAction::Resume).unwrap(),
            "resume"
        );
    }
}
