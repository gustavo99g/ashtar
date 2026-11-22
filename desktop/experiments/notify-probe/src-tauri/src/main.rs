//! notify-probe: a Etapa 6 da v0.3. Um app Tauri mínimo que responde, no
//! Windows de quem roda, o que a Etapa 15 (notificações) e a 16 (iniciar com o
//! Windows) precisam saber antes de serem escritas. As perguntas e a tabela de
//! respostas estão no README.
//!
//! Tudo o que acontece vai para o registro: a caixa de baixo da janela e o
//! arquivo `probe.log` na pasta de dados do app. É por ele que se vê o que
//! chegou (ou não) com a janela escondida.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;
use std::io::Write;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_notification::NotificationExt;

/// Com este argumento o app sobe direto na bandeja. É o que o "iniciar com o
/// Windows" grava no registro.
const AUTOSTART_ARG: &str = "--autostart";

/// Escreve uma linha no arquivo e manda para a janela.
fn log(app: &AppHandle, line: impl AsRef<str>) {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
    // Hora do dia em UTC: basta para ver a ordem e os intervalos.
    let line = format!(
        "{:02}:{:02}:{:02}Z {}",
        (secs / 3600) % 24,
        (secs / 60) % 60,
        secs % 60,
        line.as_ref()
    );
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("probe.log"))
        {
            let _ = writeln!(file, "{line}");
        }
    }
    let _ = app.emit("probe-log", line);
}

/// O que a janela registra: o som que tocou, um erro do JavaScript.
#[tauri::command]
fn log_line(app: AppHandle, line: String) {
    log(&app, format!("[janela] {line}"));
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Pergunta 1: a notificação do plugin, depois de `delay_secs` (o tempo de
/// fechar a janela para a bandeja).
#[tauri::command]
fn notify_plugin(app: AppHandle, delay_secs: u64) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(delay_secs));
        let shown = app
            .notification()
            .builder()
            .title("Ana")
            .body("oi, vai entrar na sala hoje? (plugin)")
            .show();
        log(&app, format!("plugin: show() devolveu {shown:?}"));
    });
}

/// Perguntas 2 e 3: o aviso direto pela API do Windows, com dois botões. O
/// registro diz se o clique chegou e qual foi.
#[tauri::command]
fn notify_winrt(app: AppHandle, delay_secs: u64, conversation: String) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(delay_secs));
        winrt::show(&app, &conversation);
    });
}

#[cfg(windows)]
mod winrt {
    use tauri::AppHandle;
    use tauri_winrt_notification::{Duration, Sound, Toast};

    use super::{log, show_main};

    pub fn show(app: &AppHandle, conversation: &str) {
        // Instalado, o Windows conhece o app pelo identificador do
        // `tauri.conf.json`, e o aviso sai com o nome e o ícone dele. Em modo de
        // desenvolvimento esse registro não existe: é por isso que o
        // experimento vale pelo instalador.
        let app_id = app.config().identifier.clone();
        let on_click = app.clone();
        let on_dismiss = app.clone();
        let conversation = conversation.to_owned();
        let tag = conversation.clone();
        let shown = Toast::new(&app_id)
            .title("Ana")
            .text1("oi, vai entrar na sala hoje? (WinRT)")
            .text2(&format!("conversa: {conversation}"))
            .duration(Duration::Short)
            .sound(Some(Sound::Default))
            .add_button("Responder", "reply")
            .add_button("Silenciar", "mute")
            .on_activated(move |action| {
                // `None` é o clique no corpo do aviso; `Some` é o botão.
                log(
                    &on_click,
                    format!("winrt: clique na conversa {tag}, botão {action:?}"),
                );
                show_main(&on_click);
                Ok(())
            })
            .on_dismissed(move |reason| {
                log(&on_dismiss, format!("winrt: dispensado ({reason:?})"));
                Ok(())
            })
            .show();
        log(app, format!("winrt: show() devolveu {shown:?}"));
    }
}

#[cfg(not(windows))]
mod winrt {
    pub fn show(app: &tauri::AppHandle, _conversation: &str) {
        super::log(app, "winrt: só existe no Windows");
    }
}

/// Um ícone quadrado só com uma bolinha vermelha: o selo da barra de tarefas.
fn dot(size: u32) -> Image<'static> {
    let mut rgba = vec![0u8; (size * size * 4) as usize];
    let center = (size as f32 - 1.0) / 2.0;
    let radius = size as f32 / 2.0 - 1.0;
    for y in 0..size {
        for x in 0..size {
            let (dx, dy) = (x as f32 - center, y as f32 - center);
            if dx * dx + dy * dy <= radius * radius {
                let i = ((y * size + x) * 4) as usize;
                rgba[i..i + 4].copy_from_slice(&[0xED, 0x42, 0x45, 0xFF]);
            }
        }
    }
    Image::new_owned(rgba, size, size)
}

/// O ícone do app com a bolinha vermelha no canto de baixo: o da bandeja com
/// não lidas.
fn with_dot(icon: &Image<'_>) -> Image<'static> {
    let (width, height) = (icon.width(), icon.height());
    let mut rgba = icon.rgba().to_vec();
    let radius = width as f32 * 0.28;
    let (cx, cy) = (width as f32 - radius - 1.0, height as f32 - radius - 1.0);
    for y in 0..height {
        for x in 0..width {
            let (dx, dy) = (x as f32 - cx, y as f32 - cy);
            if dx * dx + dy * dy <= radius * radius {
                let i = ((y * width + x) * 4) as usize;
                rgba[i..i + 4].copy_from_slice(&[0xED, 0x42, 0x45, 0xFF]);
            }
        }
    }
    Image::new_owned(rgba, width, height)
}

/// Pergunta 4: o ponto de não lido, na bandeja e na barra de tarefas.
#[tauri::command]
fn set_unread(app: AppHandle, unread: bool) {
    let Some(icon) = app.default_window_icon().cloned() else {
        log(&app, "não lido: o app não tem ícone padrão");
        return;
    };
    if let Some(tray) = app.tray_by_id("main") {
        let icon = if unread {
            with_dot(&icon)
        } else {
            icon.to_owned()
        };
        let result = tray.set_icon(Some(icon));
        log(&app, format!("bandeja: set_icon devolveu {result:?}"));
    }
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(windows)]
        {
            let result = window.set_overlay_icon(unread.then(|| dot(32)));
            log(
                &app,
                format!("barra de tarefas: set_overlay_icon devolveu {result:?}"),
            );
        }
        #[cfg(not(windows))]
        let _ = (window, dot(32));
    }
}

/// Pergunta 5: iniciar com o Windows.
#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) {
    let autostart = app.autolaunch();
    let result = if enabled {
        autostart.enable()
    } else {
        autostart.disable()
    };
    log(
        &app,
        format!(
            "autostart: pedido {enabled}, devolveu {result:?}, agora is_enabled = {:?}",
            autostart.is_enabled()
        ),
    );
}

/// Pergunta 6: daqui a `minutes`, o Rust pede um som à janela. A espera é no
/// Rust de propósito: um `setTimeout` de janela escondida pode atrasar, e aí
/// não daria para saber se o que falhou foi o relógio ou o áudio.
#[tauri::command]
fn sound_in(app: AppHandle, minutes: u64) {
    log(&app, format!("som: pedido para daqui a {minutes} min"));
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(minutes * 60));
        let visible = app
            .get_webview_window("main")
            .and_then(|w| w.is_visible().ok());
        log(
            &app,
            format!("som: pedindo agora (janela visível: {visible:?})"),
        );
        let _ = app.emit("probe-sound", ());
    });
}

/// O plano B: uma janela pequena do próprio app, sem borda, sempre no topo, no
/// canto de baixo à direita, que não rouba o foco. Some sozinha em 6 segundos.
#[tauri::command]
fn own_toast(app: AppHandle, delay_secs: u64) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(delay_secs));
        let handle = app.clone();
        // Criar janela é coisa da thread principal.
        let _ = app.run_on_main_thread(move || match build_toast(&handle) {
            Ok(()) => log(&handle, "aviso próprio: janela criada"),
            Err(error) => log(&handle, format!("aviso próprio: falhou ({error})")),
        });
    });
}

fn build_toast(app: &AppHandle) -> tauri::Result<()> {
    if let Some(old) = app.get_webview_window("toast") {
        let _ = old.close();
    }
    let (width, height) = (360.0, 96.0);
    let window = WebviewWindowBuilder::new(app, "toast", WebviewUrl::App("toast.html".into()))
        .title("Ashtar")
        .inner_size(width, height)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()?;
    if let Some(monitor) = window.primary_monitor()? {
        // A área útil já desconta a barra de tarefas.
        let area = monitor.work_area();
        let scale = monitor.scale_factor();
        let margin = 16.0 * scale;
        let x = area.position.x as f64 + area.size.width as f64 - width * scale - margin;
        let y = area.position.y as f64 + area.size.height as f64 - height * scale - margin;
        window.set_position(PhysicalPosition::new(x, y))?;
    }
    window.show()?;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(6));
        if let Some(window) = app.get_webview_window("toast") {
            let _ = window.close();
        }
    });
    Ok(())
}

/// O clique no aviso próprio.
#[tauri::command]
fn toast_clicked(app: AppHandle) {
    log(&app, "aviso próprio: clique");
    if let Some(window) = app.get_webview_window("toast") {
        let _ = window.close();
    }
    show_main(&app);
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Abrir", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Ashtar Notify Probe")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        // Pergunta 2, o outro caminho: se o clique num aviso abrir o app de
        // novo em vez de chamar o processo que já roda, é aqui que ele chega.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            log(
                app,
                format!("segunda abertura do app, argumentos: {args:?}"),
            );
            show_main(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_ARG]),
        ))
        // Fechar a janela principal esconde na bandeja, como no Ashtar.
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                    log(window.app_handle(), "janela: escondida na bandeja");
                }
                WindowEvent::Focused(focused) => {
                    log(window.app_handle(), format!("janela: foco = {focused}"));
                }
                _ => {}
            }
        })
        .setup(|app| {
            build_tray(app)?;
            let args: Vec<String> = std::env::args().skip(1).collect();
            let from_autostart = args.iter().any(|arg| arg == AUTOSTART_ARG);
            log(
                app.handle(),
                format!(
                    "início: versão {}, argumentos {args:?}",
                    app.package_info().version
                ),
            );
            // A janela nasce invisível (`tauri.conf.json`): só aparece aqui, e
            // nunca quando o app subiu com o Windows. Assim ela não pisca.
            if !from_autostart {
                show_main(app.handle());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            log_line,
            notify_plugin,
            notify_winrt,
            set_unread,
            set_autostart,
            sound_in,
            own_toast,
            toast_clicked,
        ])
        .run(tauri::generate_context!())
        .expect("o notify-probe não subiu");
}
