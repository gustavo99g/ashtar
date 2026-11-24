//! O [`AmfEncoder`]: a mesma cara do `MfEncoder`, falando direto com o AMF.
//!
//! O AMF é síncrono por chamada: `SubmitInput` aceita a imagem ou responde que está cheio
//! (`AMF_INPUT_FULL`), e `QueryOutput` devolve o que já ficou pronto, sem esperar. Não há eventos
//! como no Media Foundation, então o `poll` só pergunta até não vir mais nada.

use std::cell::Cell;
use std::ffi::c_void;

use windows::core::{w, Interface, PCWSTR};
use windows::Win32::Graphics::Direct3D11::ID3D11Texture2D;

use super::ffi::{
    check, factory, AmfResult, AmfVariant, Buffer, Component, Context, Data, Ref, Surface,
    AMF_DX11_0, AMF_EOF, AMF_INPUT_FULL, AMF_NEED_MORE_INPUT, AMF_OK, AMF_REPEAT, AMF_SURFACE_NV12,
    IID_AMF_BUFFER,
};
use crate::error::AppError;
use crate::media::h264::{nal_types, ParamSets};
use crate::media::platform::win32::gpu::GpuDevice;
use crate::media::platform::win32::mf_encoder::{
    EncodedOutput, EncoderSettings, FIRST_OUTPUTS_LOGGED, GOP_SECONDS,
};
use crate::media::video::h264_level;

/// O encoder H.264 da AMD (`components/VideoEncoderVCE.h`).
const ENCODER_ID: PCWSTR = w!("AMFVideoEncoderVCE_AVC");

// Os valores dos enums de `components/VideoEncoderVCE.h` que o app usa.
const USAGE_ULTRA_LOW_LATENCY: i64 = 1;
const PROFILE_HIGH: i64 = 100;
const RATE_CONTROL_CBR: i64 = 1;
const PICTURE_TYPE_IDR: i64 = 2;
const OUTPUT_DATA_TYPE_IDR: i64 = 0;

pub struct AmfEncoder {
    // A ordem importa: o componente é solto antes do contexto em que foi criado.
    component: Ref<Component>,
    context: Ref<Context>,
    name: String,
    frame_duration: i64,
    /// O próximo quadro sai como IDR, com o SPS e o PPS. Começa ligado: o primeiro também.
    keyframe_pending: Cell<bool>,
    /// O SPS e o PPS que o encoder mandou, para o IDR que vier sem eles (`h264.rs`).
    params: ParamSets,
    logged: u32,
}

impl AmfEncoder {
    /// O encoder da AMD no dispositivo de `gpu`, já configurado. Falha sem o driver da AMD.
    pub fn new(gpu: &GpuDevice, settings: EncoderSettings) -> Result<Self, AppError> {
        let factory = factory()?;
        // SAFETY: `factory` é a fábrica viva do AMF (nunca solta); os ponteiros de saída são
        // locais, e cada objeto criado passa a ser de uma `Ref`, que o solta uma vez.
        let (context, component) = unsafe {
            let vtbl = &*(*factory).vtbl;
            let mut context = std::ptr::null_mut();
            check(
                "CreateContext",
                (vtbl.create_context)(factory, &mut context),
            )?;
            let context = Ref::new(context)
                .ok_or_else(|| AppError::VideoCapture("CreateContext sem o contexto".into()))?;
            let ctx_vtbl = &*(*context.as_ptr()).vtbl;
            check(
                "InitDX11",
                (ctx_vtbl.init_dx11)(context.as_ptr(), gpu.device().as_raw(), AMF_DX11_0),
            )?;
            let mut component = std::ptr::null_mut();
            check(
                "CreateComponent",
                (vtbl.create_component)(factory, context.as_ptr(), ENCODER_ID, &mut component),
            )?;
            let component = Ref::new(component)
                .ok_or_else(|| AppError::VideoCapture("CreateComponent sem o componente".into()))?;
            (context, component)
        };

        configure(&component, settings);

        // SAFETY: o componente é vivo e as dimensões vêm das configurações (alinhadas em 16).
        unsafe {
            let vtbl = &*(*component.as_ptr()).vtbl;
            check(
                "AMFComponent::Init",
                (vtbl.init)(
                    component.as_ptr(),
                    AMF_SURFACE_NV12,
                    settings.width as i32,
                    settings.height as i32,
                ),
            )?;
        }

        tracing::info!(
            target: "media",
            placa = gpu.adapter_name(),
            largura = settings.width,
            altura = settings.height,
            fps = settings.fps,
            bitrate = settings.bitrate_bps,
            "encoder AMF aberto"
        );

        Ok(Self {
            component,
            context,
            name: "AMF".into(),
            frame_duration: 10_000_000 / i64::from(settings.fps.max(1)),
            keyframe_pending: Cell::new(true),
            params: ParamSets::default(),
            logged: 0,
        })
    }

    /// O nome do encoder, para o painel e o log.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Entrega uma textura NV12 ao encoder, com o horário da imagem (100 ns). Devolve `false` se
    /// o encoder estava cheio e não aceitou: a imagem se perde, e o `poll` abre espaço.
    pub fn submit(&mut self, texture: &ID3D11Texture2D, time: i64) -> Result<bool, AppError> {
        // SAFETY: a textura é do mesmo dispositivo dado ao contexto (`InitDX11`), e o anel do
        // conversor garante que ela não é reescrita enquanto o encoder a lê. A superfície criada
        // é de uma `Ref`, que a solta depois do `SubmitInput` (o encoder guarda a própria
        // referência).
        unsafe {
            let ctx_vtbl = &*(*self.context.as_ptr()).vtbl;
            let mut surface = std::ptr::null_mut();
            check(
                "CreateSurfaceFromDX11Native",
                (ctx_vtbl.create_surface_from_dx11_native)(
                    self.context.as_ptr(),
                    texture.as_raw(),
                    &mut surface,
                    std::ptr::null_mut(),
                ),
            )?;
            let surface: Ref<Surface> = Ref::new(surface).ok_or_else(|| {
                AppError::VideoCapture("CreateSurfaceFromDX11Native sem a superfície".into())
            })?;
            let data_vtbl = &*(*surface.as_ptr()).vtbl;
            (data_vtbl.set_pts)(surface.as_ptr().cast(), time);
            (data_vtbl.set_duration)(surface.as_ptr().cast(), self.frame_duration);

            let keyframe = self.keyframe_pending.get();
            if keyframe {
                surface.set(w!("ForcePictureType"), AmfVariant::int(PICTURE_TYPE_IDR));
                surface.set(w!("InsertSPS"), AmfVariant::bool(true));
                surface.set(w!("InsertPPS"), AmfVariant::bool(true));
            }

            let vtbl = &*(*self.component.as_ptr()).vtbl;
            let result = (vtbl.submit_input)(self.component.as_ptr(), surface.as_ptr().cast());
            match result {
                AMF_INPUT_FULL => Ok(false),
                result => {
                    check("SubmitInput", result)?;
                    if keyframe {
                        self.keyframe_pending.set(false);
                    }
                    Ok(true)
                }
            }
        }
    }

    /// As saídas prontas, sem esperar.
    pub fn poll(&mut self) -> Result<Vec<EncodedOutput>, AppError> {
        let mut out = Vec::new();
        loop {
            let mut data: *mut c_void = std::ptr::null_mut();
            // SAFETY: o componente é vivo; o `QueryOutput` devolve uma referência nova (ou nada),
            // que passa a ser de uma `Ref`.
            let (result, data) = unsafe {
                let vtbl = &*(*self.component.as_ptr()).vtbl;
                let result: AmfResult = (vtbl.query_output)(self.component.as_ptr(), &mut data);
                (result, Ref::<Data>::new(data.cast()))
            };
            let Some(data) = data else {
                return match result {
                    AMF_OK | AMF_REPEAT | AMF_NEED_MORE_INPUT | AMF_EOF => Ok(out),
                    result => check("QueryOutput", result).map(|()| out),
                };
            };
            if let Some(output) = self.take_output(&data) {
                out.push(output);
            }
        }
    }

    fn take_output(&mut self, data: &Ref<Data>) -> Option<EncodedOutput> {
        let buffer: Ref<Buffer> = data.query(&IID_AMF_BUFFER)?;
        let marked =
            buffer.get(w!("OutputDataType")).and_then(|v| v.as_int()) == Some(OUTPUT_DATA_TYPE_IDR);
        // SAFETY: o buffer é vivo durante o bloco; os bytes são copiados antes de ele ser solto.
        let (time, bytes) = unsafe {
            let vtbl = &*(*buffer.as_ptr()).vtbl;
            let time = (vtbl.data.get_pts)(buffer.as_ptr().cast());
            let size = (vtbl.get_size)(buffer.as_ptr());
            let native = (vtbl.get_native)(buffer.as_ptr()) as *const u8;
            if native.is_null() || size == 0 {
                return None;
            }
            (time, std::slice::from_raw_parts(native, size).to_vec())
        };
        if self.logged < FIRST_OUTPUTS_LOGGED {
            self.logged += 1;
            tracing::info!(
                target: "media",
                bytes = bytes.len(),
                marcado_keyframe = marked,
                nal = ?nal_types(&bytes),
                inicio = ?&bytes[..bytes.len().min(8)],
                "saída do encoder AMF"
            );
        }
        let (data, keyframe) = self.params.fix(bytes, marked);
        Some(EncodedOutput {
            time,
            keyframe,
            data,
        })
    }

    /// O próximo quadro sai como IDR. Sempre aceito: vai na próxima superfície.
    pub fn force_keyframe(&self) -> bool {
        self.keyframe_pending.set(true);
        true
    }

    /// Troca o bitrate no meio. Devolve se o encoder aceitou.
    pub fn set_bitrate(&self, bps: u32) -> bool {
        let target = self
            .component
            .set(w!("TargetBitrate"), AmfVariant::int(i64::from(bps)));
        let peak = self
            .component
            .set(w!("PeakBitrate"), AmfVariant::int(i64::from(bps)));
        target == AMF_OK && peak == AMF_OK
    }
}

impl Drop for AmfEncoder {
    fn drop(&mut self) {
        // SAFETY: os dois são vivos; o componente termina antes do contexto em que foi criado, e
        // os erros no encerramento são ignorados. As `Ref` soltam as referências depois.
        unsafe {
            let vtbl = &*(*self.component.as_ptr()).vtbl;
            let _ = (vtbl.terminate)(self.component.as_ptr());
            let ctx_vtbl = &*(*self.context.as_ptr()).vtbl;
            let _ = (ctx_vtbl.terminate)(self.context.as_ptr());
        }
    }
}

/// As propriedades, na ordem que o AMF pede: o `Usage` primeiro (ele redefine as outras), e tudo
/// antes do `Init`. Uma recusada vai para o log e o resto segue, como no Media Foundation.
fn configure(component: &Ref<Component>, settings: EncoderSettings) {
    let bitrate = i64::from(settings.bitrate_bps);
    let level = h264_level(settings.width, settings.height, settings.fps);
    let properties: [(&str, PCWSTR, AmfVariant); 11] = [
        (
            "Usage",
            w!("Usage"),
            AmfVariant::int(USAGE_ULTRA_LOW_LATENCY),
        ),
        ("Profile", w!("Profile"), AmfVariant::int(PROFILE_HIGH)),
        (
            "ProfileLevel",
            w!("ProfileLevel"),
            AmfVariant::int(i64::from(level)),
        ),
        (
            "FrameSize",
            w!("FrameSize"),
            AmfVariant::size(settings.width, settings.height),
        ),
        (
            "FrameRate",
            w!("FrameRate"),
            AmfVariant::rate(settings.fps, 1),
        ),
        (
            "RateControlMethod",
            w!("RateControlMethod"),
            AmfVariant::int(RATE_CONTROL_CBR),
        ),
        (
            "TargetBitrate",
            w!("TargetBitrate"),
            AmfVariant::int(bitrate),
        ),
        ("PeakBitrate", w!("PeakBitrate"), AmfVariant::int(bitrate)),
        (
            "FillerDataEnable",
            w!("FillerDataEnable"),
            AmfVariant::bool(false),
        ),
        (
            "BPicturesPattern",
            w!("BPicturesPattern"),
            AmfVariant::int(0),
        ),
        (
            "IDRPeriod",
            w!("IDRPeriod"),
            AmfVariant::int(i64::from(settings.fps * GOP_SECONDS)),
        ),
    ];
    for (name, key, value) in properties {
        let result = component.set(key, value);
        if result != AMF_OK {
            tracing::info!(target: "media", resultado = result, "o AMF recusou: {name}");
        }
    }
}
