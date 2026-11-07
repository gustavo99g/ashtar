//! Redução e conversão na GPU, com o `ID3D11VideoProcessor` (ADR 0018).
//!
//! É o hardware de vídeo da placa fazendo o que o caminho antigo fazia na CPU (`argb_to_i420` e o
//! `scale` do libyuv), na resolução nativa. Duas saídas:
//!
//! - NV12 em BT.709 de faixa limitada, o que o encoder e os decoders esperam (a transmissão);
//! - BGRA pequeno (as miniaturas do seletor).
//!
//! A saída vai para um anel de texturas: o encoder é assíncrono e ainda pode estar lendo uma
//! quando a próxima é escrita. Com [`RING`] texturas, o pipeline nunca deixa mais que `RING - 1`
//! no encoder.
//!
//! O tamanho da saída é fixo; a entrada pode ter outro formato (uma janela redimensionada): ela é
//! ajustada sem distorcer, no meio, com bordas pretas (`media::video::letterbox`).

use std::mem::ManuallyDrop;

use windows::core::Interface;
use windows::Win32::Foundation::RECT;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709, DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709,
    DXGI_FORMAT, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_NV12, DXGI_RATIONAL, DXGI_SAMPLE_DESC,
};

use super::gpu::GpuDevice;
use super::hr::hr;
use crate::error::AppError;
use crate::media::video::letterbox;

/// Quantas texturas de saída o anel tem.
pub const RING: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputFormat {
    /// Para o encoder (e o plano B).
    Nv12,
    /// Para as miniaturas.
    Bgra,
}

impl OutputFormat {
    fn dxgi(self) -> DXGI_FORMAT {
        match self {
            Self::Nv12 => DXGI_FORMAT_NV12,
            Self::Bgra => DXGI_FORMAT_B8G8R8A8_UNORM,
        }
    }
}

pub struct Converter {
    context: ID3D11DeviceContext,
    video_context: ID3D11VideoContext,
    processor: ID3D11VideoProcessor,
    /// Cópia própria da imagem de entrada: o frame do WGC volta para o pool logo depois da cópia.
    input: ID3D11Texture2D,
    input_view: ID3D11VideoProcessorInputView,
    input_size: (u32, u32),
    outputs: Vec<(ID3D11Texture2D, ID3D11VideoProcessorOutputView)>,
    output_size: (u32, u32),
}

impl Converter {
    /// Prepara a conversão de imagens BGRA de `input` para `output` no formato `format`.
    pub fn new(
        gpu: &GpuDevice,
        input: (u32, u32),
        output: (u32, u32),
        format: OutputFormat,
        fps: u32,
    ) -> Result<Self, AppError> {
        let device = gpu.device();
        let rate = DXGI_RATIONAL {
            Numerator: fps.max(1),
            Denominator: 1,
        };
        let desc = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
            InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
            InputFrameRate: rate,
            InputWidth: input.0,
            InputHeight: input.1,
            OutputFrameRate: rate,
            OutputWidth: output.0,
            OutputHeight: output.1,
            Usage: D3D11_VIDEO_USAGE_OPTIMAL_SPEED,
        };

        // SAFETY: todas as chamadas abaixo são COM em interfaces válidas do mesmo dispositivo, com
        // descritores locais vivos durante cada chamada.
        unsafe {
            let video_device: ID3D11VideoDevice = device.cast().map_err(hr("ID3D11VideoDevice"))?;
            let video_context: ID3D11VideoContext =
                gpu.context().cast().map_err(hr("ID3D11VideoContext"))?;

            let enumerator = video_device
                .CreateVideoProcessorEnumerator(&desc)
                .map_err(hr("CreateVideoProcessorEnumerator"))?;
            let support = enumerator
                .CheckVideoProcessorFormat(format.dxgi())
                .map_err(hr("CheckVideoProcessorFormat"))?;
            if support & D3D11_VIDEO_PROCESSOR_FORMAT_SUPPORT_OUTPUT.0 as u32 == 0 {
                return Err(AppError::VideoCapture(format!(
                    "o VideoProcessor desta placa não gera {format:?}"
                )));
            }
            let processor = video_device
                .CreateVideoProcessor(&enumerator, 0)
                .map_err(hr("CreateVideoProcessor"))?;

            video_context.VideoProcessorSetStreamFrameFormat(
                &processor,
                0,
                D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
            );
            // Sem os "melhoramentos" automáticos do driver (nitidez, redução de ruído): mudam a
            // imagem e gastam GPU.
            video_context.VideoProcessorSetStreamAutoProcessingMode(&processor, 0, false);

            // A tela é RGB completo; o vídeo sai em BT.709 de faixa limitada. Placas sem o
            // `ID3D11VideoContext1` ficam no padrão do driver, que é o mesmo na prática.
            if let Ok(vc1) = video_context.cast::<ID3D11VideoContext1>() {
                vc1.VideoProcessorSetStreamColorSpace1(
                    &processor,
                    0,
                    DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709,
                );
                if format == OutputFormat::Nv12 {
                    vc1.VideoProcessorSetOutputColorSpace1(
                        &processor,
                        DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709,
                    );
                }
            }

            // Bordas pretas quando a entrada não tem a proporção da saída.
            let black = D3D11_VIDEO_COLOR {
                Anonymous: D3D11_VIDEO_COLOR_0 {
                    RGBA: D3D11_VIDEO_COLOR_RGBA {
                        R: 0.0,
                        G: 0.0,
                        B: 0.0,
                        A: 1.0,
                    },
                },
            };
            video_context.VideoProcessorSetOutputBackgroundColor(&processor, false, &black);
            let (x, y, w, h) = letterbox(input, output);
            let dest = RECT {
                left: x as i32,
                top: y as i32,
                right: (x + w) as i32,
                bottom: (y + h) as i32,
            };
            video_context.VideoProcessorSetStreamDestRect(&processor, 0, true, Some(&dest));

            let input_texture = texture(
                device,
                input,
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
            video_device
                .CreateVideoProcessorInputView(
                    &input_texture,
                    &enumerator,
                    &input_desc,
                    Some(&mut input_view),
                )
                .map_err(hr("CreateVideoProcessorInputView"))?;

            let output_desc = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
                ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
                Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 {
                    Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 },
                },
            };
            let mut outputs = Vec::with_capacity(RING);
            for _ in 0..RING {
                let out = texture(device, output, format.dxgi(), D3D11_BIND_RENDER_TARGET)?;
                let mut view = None;
                video_device
                    .CreateVideoProcessorOutputView(
                        &out,
                        &enumerator,
                        &output_desc,
                        Some(&mut view),
                    )
                    .map_err(hr("CreateVideoProcessorOutputView"))?;
                let view = view.ok_or_else(|| {
                    AppError::VideoCapture("CreateVideoProcessorOutputView sem a view".into())
                })?;
                outputs.push((out, view));
            }

            Ok(Self {
                context: gpu.context().clone(),
                video_context,
                processor,
                input: input_texture,
                input_view: input_view.ok_or_else(|| {
                    AppError::VideoCapture("CreateVideoProcessorInputView sem a view".into())
                })?,
                input_size: input,
                outputs,
                output_size: output,
            })
        }
    }

    pub fn input_size(&self) -> (u32, u32) {
        self.input_size
    }

    pub fn output_size(&self) -> (u32, u32) {
        self.output_size
    }

    /// Copia a imagem do WGC para a entrada própria (GPU para GPU). `frame` tem de ser BGRA, do
    /// tamanho de [`Converter::input_size`].
    pub fn store(&self, frame: &ID3D11Texture2D) {
        // SAFETY: as duas texturas são do mesmo dispositivo, com o mesmo tamanho e formato (o
        // pipeline recria o conversor quando o tamanho do WGC muda).
        unsafe { self.context.CopyResource(&self.input, frame) };
    }

    /// Escreve na entrada uma imagem BGRA da memória (a da pausa), do tamanho da entrada.
    pub fn store_pixels(&self, bgra: &[u8]) {
        let (width, height) = self.input_size;
        debug_assert_eq!(bgra.len(), (width * height * 4) as usize);
        // SAFETY: `bgra` tem `width × height × 4` bytes, com linhas de `width × 4`, e vive
        // durante a chamada; a textura de entrada tem esse tamanho e é do mesmo dispositivo.
        unsafe {
            self.context
                .UpdateSubresource(&self.input, 0, None, bgra.as_ptr().cast(), width * 4, 0)
        };
    }

    /// Reduz e converte a última imagem guardada para a textura `slot` do anel, e a devolve.
    pub fn convert(&self, slot: usize) -> Result<&ID3D11Texture2D, AppError> {
        let (texture, view) = &self.outputs[slot % RING];
        let mut streams = [D3D11_VIDEO_PROCESSOR_STREAM {
            Enable: true.into(),
            pInputSurface: ManuallyDrop::new(Some(self.input_view.clone())),
            ..Default::default()
        }];
        // SAFETY: o processador, a view de saída e o stream (com a view de entrada) são válidos e
        // do mesmo dispositivo; sem quadros passados nem futuros (vídeo progressivo).
        let result = unsafe {
            self.video_context
                .VideoProcessorBlt(&self.processor, view, 0, &streams)
        };
        // A struct guarda a view num ManuallyDrop: devolve a referência que o `clone` pegou.
        // SAFETY: o ManuallyDrop é solto uma única vez, aqui, e não é usado depois.
        unsafe { ManuallyDrop::drop(&mut streams[0].pInputSurface) };
        result.map_err(hr("VideoProcessorBlt"))?;
        Ok(texture)
    }
}

fn texture(
    device: &ID3D11Device,
    (width, height): (u32, u32),
    format: DXGI_FORMAT,
    bind: D3D11_BIND_FLAG,
) -> Result<ID3D11Texture2D, AppError> {
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
    // SAFETY: `desc` é um descritor válido, vivo durante a chamada; sem dados iniciais.
    unsafe { device.CreateTexture2D(&desc, None, Some(&mut texture)) }
        .map_err(hr("CreateTexture2D"))?;
    texture.ok_or_else(|| AppError::VideoCapture("CreateTexture2D sem textura".into()))
}
