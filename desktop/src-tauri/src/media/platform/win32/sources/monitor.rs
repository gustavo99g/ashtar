//! Detalhes de um monitor: posicao, tamanho e se e o principal.
//!
//! Usado por `media::sources::list_capture_sources`. O DesktopCapturer
//! identifica telas pelo indice do `EnumDisplayDevicesW`, nao pelo
//! `HMONITOR` — numa maquina com um monitor so isso pode funcionar por
//! coincidencia e quebrar com dois. A ponte entre os dois e o nome do
//! dispositivo (`\\.\DISPLAY1`): `display_device_name` pega o nome pelo
//! indice do DesktopCapturer, e `monitor_info` (via `EnumDisplayMonitors`)
//! pega o mesmo nome por `HMONITOR`; o que bate e o monitor certo.

use std::{mem, ptr};

use windows_sys::Win32::{
    Foundation::RECT,
    Graphics::Gdi::{
        EnumDisplayDevicesW, EnumDisplayMonitors, GetMonitorInfoW, DISPLAY_DEVICEW, HDC, HMONITOR,
        MONITORINFO, MONITORINFOEXW,
    },
    UI::WindowsAndMessaging::MONITORINFOF_PRIMARY,
};

use crate::media::sources::MonitorInfo;

fn display_device_name(index: u32) -> Option<Vec<u16>> {
    // SAFETY: `DISPLAY_DEVICEW` e `#[repr(C)]` com campos primitivos/arrays
    // de u16; todo-zero e valido como buffer de entrada/saida, e `cb` (o
    // tamanho) e preenchido antes da chamada, como a API exige.
    let mut device: DISPLAY_DEVICEW = unsafe { mem::zeroed() };
    device.cb = mem::size_of::<DISPLAY_DEVICEW>() as u32;

    // SAFETY: `ptr::null()` pede o primeiro nivel de enumeracao (adaptadores
    // de video, nao monitores); `&mut device` tem o tamanho que `cb`
    // declara, como a API exige.
    let ok = unsafe { EnumDisplayDevicesW(ptr::null(), index, &mut device, 0) };

    if ok == 0 {
        return None;
    }

    Some(until_nul(&device.DeviceName))
}

/// Textos do Windows vem em arrays de tamanho fixo e terminam no primeiro
/// zero; o que vem depois e lixo de chamadas anteriores.
pub fn until_nul(text: &[u16]) -> Vec<u16> {
    let len = text.iter().position(|&c| c == 0).unwrap_or(text.len());
    text[..len].to_vec()
}

fn all_monitors() -> Vec<HMONITOR> {
    let mut monitors: Vec<HMONITOR> = Vec::new();

    // SAFETY: `collect_monitor` so escreve no `Vec` atraves do ponteiro
    // passado em `data`, que aponta para `monitors` e permanece valido ate o
    // fim desta chamada (`EnumDisplayMonitors` e sincrona: so retorna depois
    // de invocar o callback para todos os monitores).
    unsafe {
        EnumDisplayMonitors(
            ptr::null_mut(),
            ptr::null(),
            Some(collect_monitor),
            &mut monitors as *mut Vec<HMONITOR> as isize,
        )
    };
    monitors
}

/// Callback do `EnumDisplayMonitors`: so coleta o handle, nada de logica aqui.
unsafe extern "system" fn collect_monitor(
    hmonitor: HMONITOR,
    _hdc: HDC,
    _rect: *mut RECT,
    data: isize,
) -> i32 {
    // SAFETY: `data` e o ponteiro para o `Vec<HMONITOR>` de `all_monitors`,
    // valido durante toda a enumeracao (ver SAFETY em `all_monitors`); o
    // Windows so chama este callback de uma thread por vez, sem alias.
    let monitors = unsafe { &mut *(data as *mut Vec<HMONITOR>) };
    monitors.push(hmonitor);
    1 // diferente de zero = continuar enumerando
}

fn monitor_info(hmonitor: HMONITOR) -> Option<(Vec<u16>, MonitorInfo)> {
    // SAFETY: `MONITORINFOEXW` e `#[repr(C)]`; todo-zero e valido como
    // buffer de entrada/saida, e `cbSize` e preenchido com o tamanho da
    // struct estendida (com `szDevice`) antes da chamada, como a API exige
    // para o Windows preencher esse campo.
    let mut info: MONITORINFOEXW = unsafe { mem::zeroed() };
    info.monitorInfo.cbSize = mem::size_of::<MONITORINFOEXW>() as u32;
    // SAFETY: `hmonitor` veio de `EnumDisplayMonitors`, handle valido;
    // `&mut info` (reinterpretado como `MONITORINFO`) tem o `cbSize`
    // correspondente ao tamanho real alocado (`MONITORINFOEXW`), que e o
    // que permite ao Windows escrever `szDevice` com seguranca.
    let ok = unsafe {
        GetMonitorInfoW(
            hmonitor,
            &mut info as *mut MONITORINFOEXW as *mut MONITORINFO,
        )
    };
    if ok == 0 {
        return None;
    }

    let r = info.monitorInfo.rcMonitor;
    let monitor = MonitorInfo {
        x: r.left,
        y: r.top,
        width: r.right - r.left,
        height: r.bottom - r.top,
        is_primary: (info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY) != 0,
    };
    Some((until_nul(&info.szDevice), monitor))
}

/// # Bloqueia
///
/// `EnumDisplayDevicesW`/`EnumDisplayMonitors` sao sincronas. Chamar dentro
/// de `spawn_blocking`.
pub fn monitor_details(id: u64) -> Option<MonitorInfo> {
    let device_name = display_device_name(id as u32)?;

    for hmonitor in all_monitors() {
        if let Some((name, info)) = monitor_info(hmonitor) {
            if name == device_name {
                return Some(info);
            }
        }
    }
    None
}
