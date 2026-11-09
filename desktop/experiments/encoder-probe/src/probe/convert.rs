//! Redução e conversão BGRA → NV12 na GPU, com o `ID3D11VideoProcessor`.
//!
//! É o hardware de vídeo da placa fazendo o que hoje o app faz na CPU (`argb_to_i420` + `scale`
//! do libyuv). A saída vai para um anel de texturas NV12: o encoder trabalha de forma assíncrona
//! e ainda pode estar lendo a textura anterior quando a próxima é escrita.

use std::mem::ManuallyDrop;

use windows::core::{Interface, Result};
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709, DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709,
    DXGI_FORMAT, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_NV12, DXGI_SAMPLE_DESC,
};

/// Quantas texturas NV12 o anel tem. O laço nunca deixa mais que `RING - 1` no encoder.
pub const RING: usize = 4;

pub struct Converter {
    context: ID3D11DeviceContext,
    video_context: ID3D11VideoContext,
    processor: ID3D11VideoProcessor,
    /// Cópia própria do último frame do WGC (o do pool volta para ele logo após a cópia).
    source: ID3D11Texture2D,
    input_view: ID3D11VideoProcessorInputView,
    outputs: Vec<(ID3D11Texture2D, ID3D11VideoProcessorOutputView)>,
    pub color_space_set: bool,
}

impl Converter {
    pub fn new(
        device: &ID3D11Device,
        context: &ID3D11DeviceContext,
        (in_w, in_h): (u32, u32),
        (out_w, out_h): (u32, u32),
        fps: u32,
    ) -> Result<Self> {
        // SAFETY: todas as chamadas são COM em interfaces válidas, com descritores locais vivos
        // durante cada chamada.
        unsafe {
            let video_device: ID3D11VideoDevice = device.cast()?;
            let video_context: ID3D11VideoContext = context.cast()?;

            let rate = DXGI_RATIONAL(fps);
            let desc = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
                InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
                InputFrameRate: rate,
                InputWidth: in_w,
                InputHeight: in_h,
                OutputFrameRate: rate,
                OutputWidth: out_w,
                OutputHeight: out_h,
                Usage: D3D11_VIDEO_USAGE_OPTIMAL_SPEED,
            };
            let enumerator = video_device.CreateVideoProcessorEnumerator(&desc)?;
            let support = enumerator.CheckVideoProcessorFormat(DXGI_FORMAT_NV12)?;
            if support & D3D11_VIDEO_PROCESSOR_FORMAT_SUPPORT_OUTPUT.0 as u32 == 0 {
                return Err(windows::core::Error::new(
                    windows::Win32::Foundation::E_NOTIMPL,
                    "o VideoProcessor desta placa não gera NV12",
                ));
            }
            let processor = video_device.CreateVideoProcessor(&enumerator, 0)?;

            video_context.VideoProcessorSetStreamFrameFormat(
                &processor,
                0,
                D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
            );
            video_context.VideoProcessorSetStreamAutoProcessingMode(&processor, 0, false);

            // Cor: tela em RGB completo → vídeo BT.709 em faixa limitada, o que decoders esperam.
            let color_space_set = match video_context.cast::<ID3D11VideoContext1>() {
                Ok(vc1) => {
                    vc1.VideoProcessorSetStreamColorSpace1(
                        &processor,
                        0,
                        DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709,
                    );
                    vc1.VideoProcessorSetOutputColorSpace1(
                        &processor,
                        DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709,
                    );
                    true
                }
                Err(_) => false,
            };

            let source = texture(
                device,
                in_w,
                in_h,
                DXGI_FORMAT_B8G8R8A8_UNORM,
                D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE,
            )?;
            let input_desc = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
                FourCC: 0,
                ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
                Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 {
                    Texture2D: D3D11_TEX2D_VPIV {
                        MipSlice: 0,
                        ArraySlice: 0,
                    },
                },
            };
            let mut input_view = None;
            video_device.CreateVideoProcessorInputView(
                &source,
                &enumerator,
                &input_desc,
                Some(&mut input_view),
            )?;

            let output_desc = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
                ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
                Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 {
                    Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 },
                },
            };
            let mut outputs = Vec::with_capacity(RING);
            for _ in 0..RING {
                let tex = texture(
                    device,
                    out_w,
                    out_h,
                    DXGI_FORMAT_NV12,
                    D3D11_BIND_RENDER_TARGET,
                )?;
                let mut view = None;
                video_device.CreateVideoProcessorOutputView(
                    &tex,
                    &enumerator,
                    &output_desc,
                    Some(&mut view),
                )?;
                outputs.push((tex, view.expect("output view")));
            }

            Ok(Self {
                context: context.clone(),
                video_context,
                processor,
                source,
                input_view: input_view.expect("input view"),
                outputs,
                color_space_set,
            })
        }
    }

    /// Copia o frame do WGC para a textura própria (cópia GPU→GPU, sem passar pela CPU).
    pub fn store(&self, frame: &ID3D11Texture2D) {
        // SAFETY: as duas texturas são do mesmo dispositivo, com o mesmo tamanho e formato
        // (o pool do WGC foi criado no tamanho da tela, em BGRA).
        unsafe { self.context.CopyResource(&self.source, frame) };
    }

    /// Reduz e converte a última imagem guardada para a textura `slot` do anel.
    pub fn convert(&self, slot: usize) -> Result<&ID3D11Texture2D> {
        let (texture, view) = &self.outputs[slot % RING];
        let stream = D3D11_VIDEO_PROCESSOR_STREAM {
            Enable: true.into(),
            pInputSurface: ManuallyDrop::new(Some(self.input_view.clone())),
            ..Default::default()
        };
        let mut streams = [stream];
        // SAFETY: processador, view de saída e o stream (com a view de entrada) são válidos e
        // do mesmo dispositivo; os ponteiros de quadros passados/futuros ficam nulos (0 quadros).
        let result = unsafe {
            self.video_context
                .VideoProcessorBlt(&self.processor, view, 0, &streams)
        };
        // A struct guarda a view em ManuallyDrop: devolve a referência que o clone pegou.
        // SAFETY: cada ManuallyDrop é solto uma única vez, aqui.
        unsafe { ManuallyDrop::drop(&mut streams[0].pInputSurface) };
        result.map(|()| texture)
    }
}

#[allow(non_snake_case)]
fn DXGI_RATIONAL(fps: u32) -> windows::Win32::Graphics::Dxgi::Common::DXGI_RATIONAL {
    windows::Win32::Graphics::Dxgi::Common::DXGI_RATIONAL {
        Numerator: fps,
        Denominator: 1,
    }
}

fn texture(
    device: &ID3D11Device,
    width: u32,
    height: u32,
    format: DXGI_FORMAT,
    bind: D3D11_BIND_FLAG,
) -> Result<ID3D11Texture2D> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: width,
        Height: height,
        MipLevels: 1,
        ArraySize: 1,
        Format: format,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: bind.0 as u32,
        CPUAccessFlags: 0,
        MiscFlags: 0,
    };
    let mut texture = None;
    // SAFETY: `desc` é um descritor válido e vivo durante a chamada; sem dados iniciais.
    unsafe { device.CreateTexture2D(&desc, None, Some(&mut texture))? };
    Ok(texture.expect("CreateTexture2D devolveu Ok sem textura"))
}
