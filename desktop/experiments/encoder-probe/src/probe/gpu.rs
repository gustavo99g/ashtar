//! Dispositivo D3D11 (compartilhado por WGC, VideoProcessor e encoder) e lista de telas.
//!
//! O mesmo `ID3D11Device` serve aos três: a textura capturada nunca sai da GPU. Como o encoder
//! usa o dispositivo de outra thread (por dentro do Media Foundation), a proteção multithread
//! do D3D11 fica ligada.

use windows::core::{Interface, Result, BOOL};
use windows::Win32::Foundation::{HMODULE, LPARAM, RECT};
use windows::Win32::Graphics::Direct3D::{
    D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_11_1,
};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Multithread,
    D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_CREATE_DEVICE_VIDEO_SUPPORT, D3D11_SDK_VERSION,
};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIDevice, IDXGIFactory1, DXGI_ADAPTER_DESC, DXGI_ADAPTER_DESC1,
};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW,
};
use windows::Win32::UI::WindowsAndMessaging::MONITORINFOF_PRIMARY;

pub struct Gpu {
    pub device: ID3D11Device,
    pub context: ID3D11DeviceContext,
    pub adapter: DXGI_ADAPTER_DESC,
}

impl Gpu {
    pub fn new() -> Result<Self> {
        let mut device = None;
        let mut context = None;
        // SAFETY: todos os ponteiros apontam para variáveis locais vivas; o adaptador nulo com
        // `D3D_DRIVER_TYPE_HARDWARE` escolhe o adaptador padrão.
        unsafe {
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
                Some(&[D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0]),
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )?;
        }
        let device = device.expect("D3D11CreateDevice devolveu Ok sem dispositivo");
        let context = context.expect("D3D11CreateDevice devolveu Ok sem contexto");

        // SAFETY: chamadas COM em interfaces válidas recém-criadas.
        let adapter = unsafe {
            let multithread: ID3D11Multithread = context.cast()?;
            let _ = multithread.SetMultithreadProtected(true);
            device.cast::<IDXGIDevice>()?.GetAdapter()?.GetDesc()?
        };
        Ok(Self {
            device,
            context,
            adapter,
        })
    }

    pub fn adapter_name(&self) -> String {
        wide(&self.adapter.Description)
    }

    pub fn luid(&self) -> u64 {
        let l = self.adapter.AdapterLuid;
        ((l.HighPart as u32 as u64) << 32) | u64::from(l.LowPart)
    }
}

/// Todas as placas do sistema, como (LUID, nome).
pub fn adapters() -> Vec<(u64, String)> {
    let mut list = Vec::new();
    // SAFETY: chamadas DXGI em interfaces válidas; a enumeração para no primeiro erro
    // (DXGI_ERROR_NOT_FOUND = fim da lista).
    unsafe {
        let Ok(factory) = CreateDXGIFactory1::<IDXGIFactory1>() else {
            return list;
        };
        let mut i = 0;
        while let Ok(adapter) = factory.EnumAdapters1(i) {
            let desc: DXGI_ADAPTER_DESC1 = match adapter.GetDesc1() {
                Ok(desc) => desc,
                Err(_) => break,
            };
            let l = desc.AdapterLuid;
            list.push((
                ((l.HighPart as u32 as u64) << 32) | u64::from(l.LowPart),
                wide(&desc.Description),
            ));
            i += 1;
        }
    }
    list
}

pub struct Monitor {
    pub handle: HMONITOR,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub primary: bool,
}

pub fn monitors() -> Vec<Monitor> {
    unsafe extern "system" fn collect(
        handle: HMONITOR,
        _: HDC,
        _: *mut RECT,
        data: LPARAM,
    ) -> BOOL {
        // SAFETY: `data` é o `&mut Vec<HMONITOR>` passado abaixo, vivo durante a enumeração.
        let list = unsafe { &mut *(data.0 as *mut Vec<HMONITOR>) };
        list.push(handle);
        true.into()
    }

    let mut handles: Vec<HMONITOR> = Vec::new();
    // SAFETY: o callback só usa `data` como o `Vec` local, que vive até o fim da chamada.
    unsafe {
        let _ = EnumDisplayMonitors(
            None,
            None,
            Some(collect),
            LPARAM(&mut handles as *mut _ as isize),
        );
    }

    handles
        .into_iter()
        .filter_map(|handle| {
            let mut info = MONITORINFOEXW::default();
            info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
            // SAFETY: `info` é um MONITORINFOEXW com `cbSize` preenchido, como a API pede.
            let ok = unsafe { GetMonitorInfoW(handle, &mut info as *mut _ as *mut MONITORINFO) };
            if !ok.as_bool() {
                return None;
            }
            let r = info.monitorInfo.rcMonitor;
            Some(Monitor {
                handle,
                name: wide(&info.szDevice),
                width: (r.right - r.left) as u32,
                height: (r.bottom - r.top) as u32,
                primary: info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
            })
        })
        .collect()
}

pub fn wide(text: &[u16]) -> String {
    let end = text.iter().position(|&c| c == 0).unwrap_or(text.len());
    String::from_utf16_lossy(&text[..end])
}
