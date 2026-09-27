//! Detalhes de um monitor: posição, tamanho e se é o principal.
//!
//! O DesktopCapturer identifica telas pelo índice do EnumDisplayDevicesW, não
//! pelo HMONITOR. A ponte entre os dois é o nome do dispositivo (\\.\DISPLAY1).

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
    let mut device: DISPLAY_DEVICEW = unsafe { std::mem::zeroed() };
    device.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;

    let ok = unsafe { EnumDisplayDevicesW(ptr::null(), index, &mut device, 0) };

    if ok == 0 {
        return None;
    }

    Some(until_nul(&device.DeviceName))
}

pub fn until_nul(text: &[u16]) -> Vec<u16> {
    let len = text.iter().position(|&c| c == 0).unwrap_or(text.len());
    text[..len].to_vec()
}

fn all_monitors() -> Vec<HMONITOR> {
    let mut monitors: Vec<HMONITOR> = Vec::new();

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

/// Textos do Windows vêm em arrays de tamanho fixo e terminam no primeiro zero;
/// o que vem depois é lixo.

unsafe extern "system" fn collect_monitor(
    hmonitor: HMONITOR,
    _hdc: HDC,
    _rect: *mut RECT,
    data: isize,
) -> i32 {
    let monitors = unsafe { &mut *(data as *mut Vec<HMONITOR>) };
    monitors.push(hmonitor);
    1 // diferente de zero = continuar enumerando
}

fn monitor_info(hmonitor: HMONITOR) -> Option<(Vec<u16>, MonitorInfo)> {
    let mut info: MONITORINFOEXW = unsafe { std::mem::zeroed() };
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
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
