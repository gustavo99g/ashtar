//! Encoder H.264 de hardware pelo Media Foundation (MFT assíncrono, entrada em textura D3D11).
//!
//! Os MFTs de hardware (AMD, NVIDIA, Intel) são sempre assíncronos: o encoder avisa por eventos
//! quando aceita entrada (`METransformNeedInput`) e quando tem saída (`METransformHaveOutput`).
//! O laço principal chama [`Encoder::poll`] sem bloquear e só entrega um frame quando há um
//! pedido de entrada pendente; sem pedido, o frame é descartado (e contado).
//!
//! Também expõe o que o publicador vai precisar: pedir keyframe e trocar o bitrate em
//! andamento, que correspondem ao `take_keyframe_request` e ao `take_rate_control_request` da
//! crate `livekit`.

use std::mem::ManuallyDrop;

use windows::core::{Interface, Result, GUID, PWSTR};
use windows::Win32::Foundation::{VARIANT_FALSE, VARIANT_TRUE};
use windows::Win32::Graphics::Direct3D11::{ID3D11Device, ID3D11Texture2D};
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::System::Variant::{VARIANT, VT_BOOL, VT_UI4, VT_UI8};

use super::args::Profile;

pub struct EncoderInfo {
    pub name: String,
    /// LUID do adaptador (placa) a que o encoder pertence. Os MFTs de hardware são um por placa,
    /// e o encoder precisa ser da mesma placa do dispositivo D3D11 que produz as texturas.
    pub luid: Option<u64>,
    pub activate: IMFActivate,
}

/// Encoders de hardware registrados que recebem NV12 e produzem `codec`.
pub fn hardware_encoders(codec: GUID) -> Result<Vec<EncoderInfo>> {
    let input = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: MFVideoFormat_NV12,
    };
    let output = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: codec,
    };
    let mut list: *mut Option<IMFActivate> = std::ptr::null_mut();
    let mut count = 0u32;
    // SAFETY: os ponteiros apontam para variáveis locais; o MF aloca `list` com CoTaskMemAlloc.
    unsafe {
        MFTEnumEx(
            MFT_CATEGORY_VIDEO_ENCODER,
            MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
            Some(&input),
            Some(&output),
            &mut list,
            &mut count,
        )?;
    }
    let mut found = Vec::new();
    for i in 0..count as usize {
        // SAFETY: `list` tem `count` elementos válidos; cada um é lido (movido) uma única vez.
        let activate = unsafe { list.add(i).read() };
        if let Some(activate) = activate {
            found.push(EncoderInfo {
                name: string_attribute(&activate, &MFT_FRIENDLY_NAME_Attribute)
                    .unwrap_or_else(|| "(sem nome)".into()),
                // SAFETY: leitura de atributo em interface válida.
                luid: unsafe { activate.GetUINT64(&MFT_ENUM_ADAPTER_LUID) }.ok(),
                activate,
            });
        }
    }
    // SAFETY: o vetor foi alocado pelo MF com CoTaskMemAlloc; os elementos já foram movidos.
    unsafe { CoTaskMemFree(Some(list as *const _)) };
    Ok(found)
}

fn string_attribute(attributes: &IMFActivate, key: &GUID) -> Option<String> {
    let mut value = PWSTR::null();
    let mut len = 0u32;
    // SAFETY: `value` recebe uma string alocada pelo MF, liberada logo abaixo.
    unsafe {
        attributes
            .GetAllocatedString(key, &mut value, &mut len)
            .ok()?;
        let text = value.to_string().ok();
        CoTaskMemFree(Some(value.0 as *const _));
        text
    }
}

pub enum Event {
    Output(Output),
    DrainComplete,
}

pub struct Output {
    /// Tempo do frame, em unidades de 100 ns (o mesmo passado em [`Encoder::submit`]).
    pub time: i64,
    pub keyframe: bool,
    pub data: Vec<u8>,
}

pub struct Encoder {
    transform: IMFTransform,
    events: IMFMediaEventGenerator,
    codec_api: Option<ICodecAPI>,
    /// Pedidos de entrada ainda não atendidos.
    pub need_input: u32,
    /// O que o encoder aceitou de cada configuração (para o relatório).
    pub notes: Vec<String>,
    frame_duration: i64,
    _manager: IMFDXGIDeviceManager,
}

pub struct EncoderConfig {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate_bps: u32,
    pub profile: Profile,
    /// Nível H.264 ×10 (ex.: 42), ou `None` para deixar o encoder escolher.
    pub level: Option<u32>,
    pub gop_frames: u32,
}

impl Encoder {
    pub fn new(info: &EncoderInfo, device: &ID3D11Device, config: &EncoderConfig) -> Result<Self> {
        let mut notes = Vec::new();
        // SAFETY: chamadas COM em interfaces válidas; os tipos de mídia e atributos são criados
        // aqui e vivem durante cada chamada.
        unsafe {
            let transform: IMFTransform = info.activate.ActivateObject()?;
            let attributes = transform.GetAttributes()?;
            let is_async = attributes.GetUINT32(&MF_TRANSFORM_ASYNC).unwrap_or(0) != 0;
            if !is_async {
                notes.push("encoder síncrono: este teste só cobre os assíncronos".into());
            }
            attributes.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1)?;
            let _ = attributes.SetUINT32(&MF_LOW_LATENCY, 1);

            let mut token = 0u32;
            let mut manager = None;
            MFCreateDXGIDeviceManager(&mut token, &mut manager)?;
            let manager = manager.expect("MFCreateDXGIDeviceManager sem gerenciador");
            manager.ResetDevice(device, token)?;
            transform.ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, manager.as_raw() as usize)?;

            let codec_api = transform.cast::<ICodecAPI>().ok();
            if codec_api.is_none() {
                notes.push("sem ICodecAPI: keyframe e bitrate não ajustáveis".into());
            }

            let size = (u64::from(config.width) << 32) | u64::from(config.height);
            let rate = (u64::from(config.fps) << 32) | 1;

            let output = MFCreateMediaType()?;
            output.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            output.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)?;
            output.SetUINT32(&MF_MT_AVG_BITRATE, config.bitrate_bps)?;
            output.SetUINT64(&MF_MT_FRAME_SIZE, size)?;
            output.SetUINT64(&MF_MT_FRAME_RATE, rate)?;
            output.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1 << 32) | 1)?;
            output.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
            let profile = match config.profile {
                Profile::Baseline => eAVEncH264VProfile_Base,
                Profile::Main => eAVEncH264VProfile_Main,
                Profile::High => eAVEncH264VProfile_High,
            };
            output.SetUINT32(&MF_MT_MPEG2_PROFILE, profile.0 as u32)?;
            if let Some(level) = config.level {
                output.SetUINT32(&MF_MT_MPEG2_LEVEL, level)?;
            }
            transform.SetOutputType(0, &output, 0)?;

            let input = MFCreateMediaType()?;
            input.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            input.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)?;
            input.SetUINT64(&MF_MT_FRAME_SIZE, size)?;
            input.SetUINT64(&MF_MT_FRAME_RATE, rate)?;
            input.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1 << 32) | 1)?;
            input.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
            transform.SetInputType(0, &input, 0)?;

            // O que o encoder ficou entendendo do tipo de saída.
            if let Ok(current) = transform.GetOutputCurrentType(0) {
                let level = current.GetUINT32(&MF_MT_MPEG2_LEVEL).ok();
                let rate = current.GetUINT64(&MF_MT_FRAME_RATE).ok();
                notes.push(format!(
                    "saída negociada: nível {} · fps {}",
                    level.map_or("?".into(), |l| format!("{:.1}", f64::from(l) / 10.0)),
                    rate.map_or("?".into(), |r| format!("{}/{}", r >> 32, r & 0xffff_ffff)),
                ));
            }

            // Depois dos tipos e antes de começar o fluxo, como o Chromium faz com os MFTs de hardware.
            if let Some(api) = &codec_api {
                let mut set = |name: &str, key: &GUID, value: VARIANT| {
                    let result = api.SetValue(key, &value);
                    notes.push(format!(
                        "{name}: {}",
                        if result.is_ok() { "ok" } else { "recusado" }
                    ));
                };
                set(
                    "baixa latência",
                    &CODECAPI_AVLowLatencyMode,
                    bool_variant(true),
                );
                set(
                    "CBR",
                    &CODECAPI_AVEncCommonRateControlMode,
                    u32_variant(eAVEncCommonRateControlMode_CBR.0 as u32),
                );
                set(
                    "bitrate",
                    &CODECAPI_AVEncCommonMeanBitRate,
                    u32_variant(config.bitrate_bps),
                );
                set(
                    "sem B-frames",
                    &CODECAPI_AVEncMPVDefaultBPictureCount,
                    u32_variant(0),
                );
                set(
                    "GOP",
                    &CODECAPI_AVEncMPVGOPSize,
                    u32_variant(config.gop_frames),
                );
                // O AMDh264Encoder orçou o bitrate como se fossem 30 fps mesmo com o
                // MF_MT_FRAME_RATE e o nível certos; este é o outro lugar onde o fps é informado.
                set(
                    "fps (codec API)",
                    &CODECAPI_AVEncVideoOutputFrameRate,
                    u64_variant((u64::from(config.fps) << 32) | 1),
                );
            }

            transform.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
            transform.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;

            let events: IMFMediaEventGenerator = transform.cast()?;
            Ok(Self {
                transform,
                events,
                codec_api,
                need_input: 0,
                notes,
                frame_duration: 10_000_000 / i64::from(config.fps),
                _manager: manager,
            })
        }
    }

    /// Processa os eventos pendentes sem bloquear: soma os pedidos de entrada e devolve as saídas.
    pub fn poll(&mut self) -> Result<Vec<Event>> {
        let mut out = Vec::new();
        loop {
            // SAFETY: chamada COM em interface válida; NO_WAIT nunca bloqueia.
            let event = match unsafe { self.events.GetEvent(MF_EVENT_FLAG_NO_WAIT) } {
                Ok(event) => event,
                Err(e) if e.code() == MF_E_NO_EVENTS_AVAILABLE => return Ok(out),
                Err(e) => return Err(e),
            };
            // SAFETY: `event` é um IMFMediaEvent válido.
            let kind = unsafe { event.GetType()? };
            let kind = MF_EVENT_TYPE(kind as i32);
            if kind == METransformNeedInput {
                self.need_input += 1;
            } else if kind == METransformHaveOutput {
                if let Some(output) = self.take_output()? {
                    out.push(Event::Output(output));
                }
            } else if kind == METransformDrainComplete {
                out.push(Event::DrainComplete);
            }
        }
    }

    fn take_output(&mut self) -> Result<Option<Output>> {
        let mut buffer = MFT_OUTPUT_DATA_BUFFER {
            dwStreamID: 0,
            pSample: ManuallyDrop::new(None),
            dwStatus: 0,
            pEvents: ManuallyDrop::new(None),
        };
        let mut status = 0u32;
        // SAFETY: encoders de hardware alocam a amostra de saída (MFT_OUTPUT_STREAM_PROVIDES_SAMPLES),
        // então `pSample` vai nulo; o que vier em `pSample`/`pEvents` é solto logo abaixo.
        let result = unsafe {
            self.transform
                .ProcessOutput(0, std::slice::from_mut(&mut buffer), &mut status)
        };
        // SAFETY: cada ManuallyDrop é tomado/solto uma única vez.
        let sample = unsafe { ManuallyDrop::take(&mut buffer.pSample) };
        // SAFETY: idem, para a coleção de eventos (normalmente nula).
        unsafe { ManuallyDrop::drop(&mut buffer.pEvents) };

        match result {
            Ok(()) => {}
            Err(e) if e.code() == MF_E_TRANSFORM_STREAM_CHANGE => {
                // O encoder mudou o formato de saída: aceitar o que ele propõe.
                // SAFETY: chamadas COM em interface válida.
                unsafe {
                    let proposed = self.transform.GetOutputAvailableType(0, 0)?;
                    self.transform.SetOutputType(0, &proposed, 0)?;
                }
                self.notes
                    .push("o encoder renegociou o formato de saída".into());
                return Ok(None);
            }
            Err(e) => return Err(e),
        }

        let Some(sample) = sample else {
            return Ok(None);
        };
        // SAFETY: `sample` é uma IMFSample válida; o buffer é travado e destravado aqui, e os
        // bytes são copiados antes do Unlock.
        unsafe {
            let time = sample.GetSampleTime().unwrap_or(-1);
            let keyframe = sample.GetUINT32(&MFSampleExtension_CleanPoint).unwrap_or(0) != 0;
            let media = sample.ConvertToContiguousBuffer()?;
            let mut ptr = std::ptr::null_mut();
            let mut len = 0u32;
            media.Lock(&mut ptr, None, Some(&mut len))?;
            let data = std::slice::from_raw_parts(ptr, len as usize).to_vec();
            media.Unlock()?;
            Ok(Some(Output {
                time,
                keyframe,
                data,
            }))
        }
    }

    /// Entrega uma textura NV12 ao encoder. Só chamar com `need_input > 0`.
    pub fn submit(&mut self, texture: &ID3D11Texture2D, time: i64) -> Result<()> {
        // SAFETY: a textura é do mesmo dispositivo dado ao encoder pelo gerenciador DXGI, e o
        // anel do conversor garante que ela não é reescrita enquanto o encoder a usa.
        unsafe {
            let buffer = MFCreateDXGISurfaceBuffer(&ID3D11Texture2D::IID, texture, 0, false)?;
            if let Ok(two_d) = buffer.cast::<IMF2DBuffer>() {
                buffer.SetCurrentLength(two_d.GetContiguousLength()?)?;
            }
            let sample = MFCreateSample()?;
            sample.AddBuffer(&buffer)?;
            sample.SetSampleTime(time)?;
            sample.SetSampleDuration(self.frame_duration)?;
            self.transform.ProcessInput(0, &sample, 0)?;
        }
        self.need_input -= 1;
        Ok(())
    }

    /// Pede que o próximo frame seja um keyframe. `false` = o encoder recusou.
    pub fn force_keyframe(&self) -> bool {
        self.codec_api.as_ref().is_some_and(|api| {
            // SAFETY: chamada COM em interface válida, com um VARIANT local.
            unsafe { api.SetValue(&CODECAPI_AVEncVideoForceKeyFrame, &u32_variant(1)) }.is_ok()
        })
    }

    /// Troca o bitrate alvo em andamento. `false` = o encoder recusou.
    pub fn set_bitrate(&self, bps: u32) -> bool {
        self.codec_api.as_ref().is_some_and(|api| {
            // SAFETY: chamada COM em interface válida, com um VARIANT local.
            unsafe { api.SetValue(&CODECAPI_AVEncCommonMeanBitRate, &u32_variant(bps)) }.is_ok()
        })
    }

    /// Avisa o fim do fluxo e pede para o encoder soltar o que ainda tem.
    pub fn start_drain(&self) -> Result<()> {
        // SAFETY: chamadas COM em interface válida.
        unsafe {
            self.transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0)?;
            self.transform.ProcessMessage(MFT_MESSAGE_COMMAND_DRAIN, 0)
        }
    }
}

impl Drop for Encoder {
    fn drop(&mut self) {
        // SAFETY: chamadas COM em interface válida; erros no encerramento são ignorados.
        unsafe {
            let _ = self
                .transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0);
            if let Ok(shutdown) = self.transform.cast::<IMFShutdown>() {
                let _ = shutdown.Shutdown();
            }
        }
    }
}

fn u64_variant(value: u64) -> VARIANT {
    let mut v = VARIANT::default();
    // SAFETY: preenche o tipo e o campo correspondente do union, como um VT_UI8 exige.
    unsafe {
        let inner = &mut *v.Anonymous.Anonymous;
        inner.vt = VT_UI8;
        inner.Anonymous.ullVal = value;
    }
    v
}

fn u32_variant(value: u32) -> VARIANT {
    let mut v = VARIANT::default();
    // SAFETY: preenche o tipo e o campo correspondente do union, como um VT_UI4 exige.
    unsafe {
        let inner = &mut *v.Anonymous.Anonymous;
        inner.vt = VT_UI4;
        inner.Anonymous.ulVal = value;
    }
    v
}

fn bool_variant(value: bool) -> VARIANT {
    let mut v = VARIANT::default();
    // SAFETY: preenche o tipo e o campo correspondente do union, como um VT_BOOL exige.
    unsafe {
        let inner = &mut *v.Anonymous.Anonymous;
        inner.vt = VT_BOOL;
        inner.Anonymous.boolVal = if value { VARIANT_TRUE } else { VARIANT_FALSE };
    }
    v
}
