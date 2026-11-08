//! Da GPU para a memória: o NV12 já reduzido do plano B e o BGRA pequeno das miniaturas.
//!
//! A cópia vai para uma textura "staging" (a única que a CPU consegue ler) e é lida linha a
//! linha: a textura pode ter sobra no fim de cada linha (`RowPitch`), e quem recebe quer as
//! linhas coladas.
//!
//! Ler da GPU espera ela terminar o que estava fazendo com a textura. Por isso a transmissão com
//! o encoder de hardware não passa por aqui.

use windows::Win32::Graphics::Direct3D11::{
    ID3D11Texture2D, D3D11_CPU_ACCESS_READ, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ,
    D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC;

use super::convert::OutputFormat;
use super::gpu::GpuDevice;
use super::hr::hr;
use crate::error::AppError;

pub struct Readback {
    staging: ID3D11Texture2D,
    size: (u32, u32),
    format: OutputFormat,
}

impl Readback {
    pub fn new(gpu: &GpuDevice, size: (u32, u32), format: OutputFormat) -> Result<Self, AppError> {
        let desc = D3D11_TEXTURE2D_DESC {
            Width: size.0,
            Height: size.1,
            MipLevels: 1,
            ArraySize: 1,
            Format: match format {
                OutputFormat::Nv12 => windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_NV12,
                OutputFormat::Bgra => {
                    windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM
                }
            },
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: 0,
        };
        let mut staging = None;
        // SAFETY: `desc` é um descritor válido e vivo durante a chamada; sem dados iniciais.
        unsafe {
            gpu.device()
                .CreateTexture2D(&desc, None, Some(&mut staging))
        }
        .map_err(hr("CreateTexture2D (staging)"))?;
        Ok(Self {
            staging: staging
                .ok_or_else(|| AppError::VideoCapture("CreateTexture2D sem textura".into()))?,
            size,
            format,
        })
    }

    /// Copia `texture` (do tamanho e formato desta leitura) e devolve os bytes, sem sobra nas
    /// linhas: NV12 com o Y e depois o UV; BGRA com 4 bytes por pixel.
    ///
    /// # Bloqueia
    ///
    /// Até a GPU terminar a cópia (alguns milissegundos numa 1080p).
    pub fn read(&self, gpu: &GpuDevice, texture: &ID3D11Texture2D) -> Result<Vec<u8>, AppError> {
        let (width, height) = (self.size.0 as usize, self.size.1 as usize);
        let (row_bytes, rows) = match self.format {
            // O plano UV tem metade das linhas, cada uma com a largura inteira em bytes.
            OutputFormat::Nv12 => (width, height + height / 2),
            OutputFormat::Bgra => (width * 4, height),
        };
        let context = gpu.context();
        let mut out = Vec::with_capacity(row_bytes * rows);
        // SAFETY: as duas texturas são do mesmo dispositivo, com o mesmo tamanho e formato; o
        // `Map` dá um ponteiro válido para `RowPitch × rows` bytes até o `Unmap`, e cada linha
        // é copiada antes dele.
        unsafe {
            context.CopyResource(&self.staging, texture);
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            context
                .Map(&self.staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
                .map_err(hr("Map (staging)"))?;
            let base = mapped.pData as *const u8;
            let pitch = mapped.RowPitch as usize;
            for row in 0..rows {
                let line = std::slice::from_raw_parts(base.add(row * pitch), row_bytes);
                out.extend_from_slice(line);
            }
            context.Unmap(&self.staging, 0);
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::platform::win32::convert::Converter;
    use windows::Win32::Graphics::Direct3D11::{
        D3D11_BIND_SHADER_RESOURCE, D3D11_SUBRESOURCE_DATA, D3D11_USAGE_DEFAULT,
    };
    use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;

    /// Uma textura BGRA do tamanho `size` toda de um pixel só, escrita pela CPU.
    fn bgra_texture(gpu: &GpuDevice, size: (u32, u32), pixel: [u8; 4]) -> ID3D11Texture2D {
        let pixels = pixel.repeat((size.0 * size.1) as usize);
        let desc = D3D11_TEXTURE2D_DESC {
            Width: size.0,
            Height: size.1,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: D3D11_BIND_SHADER_RESOURCE.0 as u32,
            CPUAccessFlags: 0,
            MiscFlags: 0,
        };
        let data = D3D11_SUBRESOURCE_DATA {
            pSysMem: pixels.as_ptr().cast(),
            SysMemPitch: size.0 * 4,
            SysMemSlicePitch: 0,
        };
        let mut texture = None;
        // SAFETY: `desc` e `data` são locais e vivem durante a chamada; `pixels` tem
        // `width × height × 4` bytes, com linhas de `width × 4`.
        unsafe {
            gpu.device()
                .CreateTexture2D(&desc, Some(&data), Some(&mut texture))
        }
        .expect("textura");
        texture.expect("textura")
    }

    /// Uma imagem toda vermelha (BGRA) vira NV12 com o Y, o U e o V do vermelho em BT.709 de
    /// faixa limitada: confere onde o plano UV começa e a conversão de cor, não só o tamanho.
    #[test]
    #[ignore = "precisa de uma placa de vídeo"]
    fn vermelho_vira_o_nv12_certo() {
        let gpu = GpuDevice::new().expect("dispositivo");
        let size = (64, 64);
        let converter =
            Converter::new(&gpu, size, size, OutputFormat::Nv12, 60).expect("conversor");
        converter.store(&bgra_texture(&gpu, size, [0, 0, 255, 255]));
        let texture = converter.convert(0).expect("conversão");

        let nv12 = Readback::new(&gpu, size, OutputFormat::Nv12)
            .expect("leitura")
            .read(&gpu, texture)
            .expect("bytes");
        let (width, height) = (size.0 as usize, size.1 as usize);
        assert_eq!(nv12.len(), width * height * 3 / 2);
        let y = nv12[width * 10 + 10];
        let uv = width * height + width * 5 + 10;
        let (u, v) = (nv12[uv], nv12[uv + 1]);
        println!("Y={y} U={u} V={v}");
        // BT.709 limitada, vermelho puro: Y 63, U 102, V 240 (com uma folga do driver).
        assert!(y.abs_diff(63) <= 4, "Y={y}");
        assert!(u.abs_diff(102) <= 4, "U={u}");
        assert!(v.abs_diff(240) <= 4, "V={v}");
    }
}
