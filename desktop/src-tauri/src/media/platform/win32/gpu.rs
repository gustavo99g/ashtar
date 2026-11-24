//! O dispositivo D3D11 de uma transmissão (ADR 0018).
//!
//! O mesmo `ID3D11Device` serve à captura (WGC), à conversão (`convert.rs`) e ao encoder
//! (`mf_encoder.rs`): a imagem nunca sai da GPU. O encoder usa o dispositivo de outra thread, por
//! dentro do Media Foundation, então a proteção multithread do D3D11 fica ligada.
//!
//! Um dispositivo por transmissão (e um por seletor aberto, nas miniaturas), e não um global: se
//! o driver for atualizado no meio, o dispositivo se perde (`DXGI_ERROR_DEVICE_REMOVED`) e só
//! aquela transmissão acaba.
//!
//! Os objetos COM daqui não são `Send`: o dispositivo nasce e morre na thread que o usa.

use windows::core::Interface;
use windows::Win32::Foundation::HMODULE;
use windows::Win32::Graphics::Direct3D::{
    D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_11_1,
};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Multithread,
    D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_CREATE_DEVICE_VIDEO_SUPPORT, D3D11_SDK_VERSION,
};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;

use super::hr::{hr, wide};
use crate::error::AppError;

pub struct GpuDevice {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    adapter_name: String,
    luid: u64,
    vendor: u32,
    driver: String,
}

impl GpuDevice {
    /// Cria o dispositivo na placa padrão, com suporte a BGRA (o formato do WGC) e a vídeo (o
    /// `VideoProcessor` e o encoder).
    pub fn new() -> Result<Self, AppError> {
        let mut device = None;
        let mut context = None;
        // SAFETY: os ponteiros de saída apontam para variáveis locais vivas; o adaptador nulo com
        // `D3D_DRIVER_TYPE_HARDWARE` escolhe a placa padrão, e os níveis vêm de um array local.
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
            )
        }
        .map_err(hr("D3D11CreateDevice"))?;
        let (Some(device), Some(context)) = (device, context) else {
            return Err(AppError::VideoCapture(
                "D3D11CreateDevice não devolveu o dispositivo".into(),
            ));
        };

        // SAFETY: chamadas COM em interfaces válidas, recém-criadas; o `cast` só pede uma
        // interface que todo dispositivo D3D11 tem.
        let (adapter, umd) = unsafe {
            let multithread: ID3D11Multithread = context.cast().map_err(hr("ID3D11Multithread"))?;
            let _ = multithread.SetMultithreadProtected(true);
            let dxgi = device
                .cast::<IDXGIDevice>()
                .and_then(|dxgi| dxgi.GetAdapter())
                .map_err(hr("IDXGIDevice::GetAdapter"))?;
            // A versão do driver: o `CheckInterfaceSupport` do `IDXGIDevice` a devolve.
            let umd = dxgi.CheckInterfaceSupport(&IDXGIDevice::IID).ok();
            (dxgi.GetDesc().map_err(hr("IDXGIAdapter::GetDesc"))?, umd)
        };

        let luid = adapter.AdapterLuid;
        Ok(Self {
            device,
            context,
            adapter_name: wide(&adapter.Description),
            luid: (u64::from(luid.HighPart as u32) << 32) | u64::from(luid.LowPart),
            vendor: adapter.VendorId,
            driver: umd.map_or_else(|| "?".into(), driver_version),
        })
    }

    pub fn device(&self) -> &ID3D11Device {
        &self.device
    }

    pub fn context(&self) -> &ID3D11DeviceContext {
        &self.context
    }

    /// O nome da placa, como o Gerenciador de Dispositivos mostra ("AMD Radeon RX 9060 XT").
    pub fn adapter_name(&self) -> &str {
        &self.adapter_name
    }

    /// Se a placa é da AMD (o PCI vendor id 0x1002): só nela o app chama o AMF.
    pub fn is_amd(&self) -> bool {
        self.vendor == 0x1002
    }

    /// A versão do driver da placa ("32.0.21025.1024"), ou "?".
    pub fn driver(&self) -> &str {
        &self.driver
    }

    /// O LUID da placa: o encoder tem de ser da mesma (`mf_encoder.rs`).
    pub fn luid(&self) -> u64 {
        self.luid
    }
}

/// A versão do driver como o Windows mostra: quatro números de 16 bits.
fn driver_version(umd: i64) -> String {
    let v = umd as u64;
    format!(
        "{}.{}.{}.{}",
        v >> 48,
        (v >> 32) & 0xFFFF,
        (v >> 16) & 0xFFFF,
        v & 0xFFFF
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "precisa de uma placa de vídeo"]
    fn cria_o_dispositivo_e_diz_a_placa() {
        let gpu = GpuDevice::new().expect("o dispositivo deveria ser criado");
        println!("placa: {} (LUID {:#x})", gpu.adapter_name(), gpu.luid());
        assert!(!gpu.adapter_name().is_empty());
        assert_ne!(gpu.luid(), 0);
    }

    #[test]
    fn a_versao_do_driver_sai_em_quatro_partes() {
        let umd = (32i64 << 48) | (21025 << 16) | 1024;
        assert_eq!(driver_version(umd), "32.0.21025.1024");
    }
}
