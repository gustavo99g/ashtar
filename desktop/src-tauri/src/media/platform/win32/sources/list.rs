//! A lista própria de janelas e telas do seletor (ADR 0019), no lugar da do `DesktopCapturer`.
//!
//! - Janelas pelo `EnumWindows`, inclusive as minimizadas, com os filtros do Alt + Tab
//!   (`media::sources::is_shareable`). O id é o próprio `HWND`.
//! - Telas pelo `EnumDisplayMonitors`. O id é o `HMONITOR`, que o WGC recebe direto.
//!
//! As duas funções bloqueiam (o ícone de uma janela que não responde espera até 50 ms): chamar
//! dentro de `spawn_blocking`.

use std::{mem, ptr};

use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, RECT},
    Graphics::{
        Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED},
        Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO},
    },
    UI::WindowsAndMessaging::{
        EnumWindows, GetShellWindow, GetWindow, GetWindowLongPtrW, GetWindowTextLengthW,
        GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, GWL_EXSTYLE, GW_OWNER,
        MONITORINFOF_PRIMARY, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
    },
};

use super::icon::icon_data_url;
use crate::media::sources::{is_shareable, MonitorEntry, MonitorInfo, WindowEntry, WindowFacts};

/// As janelas que aparecem no Alt + Tab, na ordem dele (a de cima primeiro), sem as do app.
///
/// # Bloqueia
///
/// O ícone de cada janela (até 50 ms se ela não responder). Chamar dentro de `spawn_blocking`.
pub fn list_windows() -> Vec<WindowEntry> {
    let own_pid = std::process::id();
    // SAFETY: sem pré-condições; devolve nulo se não houver shell (o explorer.exe caído).
    let shell = unsafe { GetShellWindow() };

    collect_windows()
        .into_iter()
        .filter_map(|hwnd| {
            let facts = facts(hwnd, own_pid, shell)?;
            if !is_shareable(&facts) {
                return None;
            }
            Some(WindowEntry {
                id: hwnd as usize as u64,
                title: facts.title,
                process_id: facts.process_id,
                minimized: facts.minimized,
                icon: icon_data_url(hwnd),
            })
        })
        .collect()
}

/// Todas as janelas de primeiro nível, na ordem do `EnumWindows` (de cima para baixo).
fn collect_windows() -> Vec<HWND> {
    unsafe extern "system" fn push(hwnd: HWND, data: LPARAM) -> i32 {
        // SAFETY: `data` é o `&mut Vec<HWND>` de `collect_windows`, vivo durante toda a
        // enumeração (o `EnumWindows` é síncrono); o Windows chama um callback por vez.
        let list = unsafe { &mut *(data as *mut Vec<HWND>) };
        list.push(hwnd);
        1 // continuar
    }

    let mut list: Vec<HWND> = Vec::new();
    // SAFETY: o callback só usa `data` como o `Vec` acima, que vive até o fim da chamada.
    unsafe { EnumWindows(Some(push), &mut list as *mut Vec<HWND> as LPARAM) };
    list
}

/// O que os filtros precisam saber de uma janela. `None`: ela sumiu no meio.
fn facts(hwnd: HWND, own_pid: u32, shell: HWND) -> Option<WindowFacts> {
    let mut process_id = 0u32;
    // SAFETY: todas as chamadas abaixo aceitam um `HWND` que acabou de fechar e só devolvem 0 ou
    // falso nesse caso; os ponteiros de saída apontam para variáveis locais.
    unsafe {
        GetWindowThreadProcessId(hwnd, &mut process_id);
        if process_id == 0 {
            return None;
        }
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let mut cloaked = 0u32;
        let cloaked_ok = DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED as u32,
            &mut cloaked as *mut u32 as *mut _,
            mem::size_of::<u32>() as u32,
        ) == 0;

        Some(WindowFacts {
            title: window_title(hwnd),
            process_id,
            visible: IsWindowVisible(hwnd) != 0,
            minimized: IsIconic(hwnd) != 0,
            cloaked: cloaked_ok && cloaked != 0,
            tool_window: ex_style & WS_EX_TOOLWINDOW != 0,
            app_window: ex_style & WS_EX_APPWINDOW != 0,
            has_owner: !GetWindow(hwnd, GW_OWNER).is_null(),
            is_shell: hwnd == shell,
            own_process: process_id == own_pid,
        })
    }
}

fn window_title(hwnd: HWND) -> String {
    // SAFETY: `GetWindowTextLengthW` aceita qualquer `HWND`; o buffer tem o tamanho informado, e o
    // `GetWindowTextW` escreve no máximo esse tanto (contando o zero do fim).
    unsafe {
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return String::new();
        }
        let mut text = vec![0u16; len as usize + 1];
        let copied = GetWindowTextW(hwnd, text.as_mut_ptr(), text.len() as i32);
        String::from_utf16_lossy(&text[..copied.max(0) as usize])
    }
}

/// As telas, na ordem do Windows.
///
/// # Bloqueia
///
/// `EnumDisplayMonitors` é síncrona. Chamar dentro de `spawn_blocking`.
pub fn list_monitors() -> Vec<MonitorEntry> {
    unsafe extern "system" fn push(monitor: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> i32 {
        // SAFETY: `data` é o `&mut Vec<HMONITOR>` abaixo, vivo durante a enumeração síncrona.
        let list = unsafe { &mut *(data as *mut Vec<HMONITOR>) };
        list.push(monitor);
        1
    }

    let mut handles: Vec<HMONITOR> = Vec::new();
    // SAFETY: o callback só usa `data` como o `Vec` acima, que vive até o fim da chamada.
    unsafe {
        EnumDisplayMonitors(
            ptr::null_mut(),
            ptr::null(),
            Some(push),
            &mut handles as *mut Vec<HMONITOR> as LPARAM,
        )
    };

    handles
        .into_iter()
        .filter_map(|monitor| {
            // SAFETY: `MONITORINFO` é `#[repr(C)]` de campos primitivos (todo-zero é válido), e o
            // `cbSize` é preenchido antes da chamada, como a API exige.
            let mut info: MONITORINFO = unsafe { mem::zeroed() };
            info.cbSize = mem::size_of::<MONITORINFO>() as u32;
            // SAFETY: `monitor` veio do `EnumDisplayMonitors`; se a tela foi desligada nesse
            // meio-tempo, a chamada só devolve 0.
            if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
                return None;
            }
            let r = info.rcMonitor;
            Some(MonitorEntry {
                id: monitor as usize as u64,
                info: MonitorInfo {
                    x: r.left,
                    y: r.top,
                    width: r.right - r.left,
                    height: r.bottom - r.top,
                    is_primary: info.dwFlags & MONITORINFOF_PRIMARY != 0,
                },
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    #[ignore = "precisa de uma área de trabalho real"]
    fn imprime_janelas_e_telas() {
        let start = Instant::now();
        let windows = list_windows();
        println!("{} janelas em {:?}", windows.len(), start.elapsed());
        for w in &windows {
            println!(
                "{:>12} | {} | pid={} | minimizada={} | ícone={}",
                w.id,
                w.title,
                w.process_id,
                w.minimized,
                w.icon.is_some()
            );
        }
        for m in list_monitors() {
            println!("tela {:>12} | {:?}", m.id, m.info);
        }
        assert!(!windows.iter().any(|w| w.process_id == std::process::id()));
    }
}
