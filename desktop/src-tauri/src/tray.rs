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

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, Window, WindowEvent};

use crate::window::bring_to_front;

/// O ícone existe, então esconder a janela é seguro.
static READY: AtomicBool = AtomicBool::new(false);

const OPEN_ID: &str = "open";
const QUIT_ID: &str = "quit";

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

fn build(app: &App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, OPEN_ID, "Abrir o Ashtar", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Ashtar")
        .menu(&menu)
        // O clique esquerdo abre a janela; o menu vem no direito.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            OPEN_ID => bring_to_front(app),
            QUIT_ID => app.exit(0),
            _ => {}
        })
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
