//! O encoder H.264 de hardware da placa, pelo Media Foundation (ADR 0018).
//!
//! Os encoders de hardware (AMD, NVIDIA, Intel) são MFTs assíncronos: avisam por eventos quando
//! aceitam entrada (`METransformNeedInput`) e quando têm saída (`METransformHaveOutput`). O
//! pipeline chama [`MfEncoder::poll`] sem bloquear e só entrega um frame quando há pedido de
//! entrada; sem pedido, o frame é descartado (e contado).
//!
//! A entrada é a textura NV12 do conversor, no mesmo dispositivo D3D11: o encoder lê direto da
//! GPU. A saída é o H.264 em Annex B, que vai para a LiveKit sem passar por outro encoder.
//!
//! **A codec API vem antes dos tipos de mídia.** Configurada depois, o encoder da AMD volta para
//! 30 fps: grava 30 fps no SPS (o vídeo sai em câmera lenta) e orça o bitrate como se fossem 30
//! (o dobro do alvo a 60 fps). Medido na Etapa 0, com o `encoder-probe` (`--codec-api-last`).

use std::mem::ManuallyDrop;

use windows::core::{Interface, GUID, PWSTR};
use windows::Win32::Foundation::{VARIANT_FALSE, VARIANT_TRUE};
use windows::Win32::Graphics::Direct3D11::ID3D11Texture2D;
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::System::Variant::{VARIANT, VT_BOOL, VT_UI4};

use super::gpu::GpuDevice;
use super::hr::hr;
use crate::error::AppError;
use crate::media::h264::{nal_types, ParamSets};
use crate::media::video::h264_level;

/// O GOP: um keyframe a cada 30 s no máximo. Os keyframes de verdade vêm sob pedido (alguém
/// entrou, a rede perdeu pacotes); este só garante que um decoder perdido se recupere sozinho.
const GOP_SECONDS: u32 = 30;

/// Quantas das primeiras saídas do encoder vão para o log, com os tipos de NAL.
const FIRST_OUTPUTS_LOGGED: u32 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EncoderSettings {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate_bps: u32,
}

/// Como as imagens chegam ao encoder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncoderInput {
    /// A textura NV12 do conversor, direto na GPU (pelo gerenciador DXGI). O normal.
    Gpu,
    /// A imagem NV12 copiada para a memória. Para o encoder da AMD na RX 7600, que com a
    /// textura aceita um quadro e para; a placa ainda codifica, só a cópia passa pela CPU.
    Memory,
}

/// Um H.264 que saiu do encoder.
pub struct EncodedOutput {
    /// O horário passado em [`MfEncoder::submit`] (100 ns, no relógio do WGC).
    pub time: i64,
    pub keyframe: bool,
    pub data: Vec<u8>,
}

pub struct MfEncoder {
    transform: IMFTransform,
    events: IMFMediaEventGenerator,
    codec_api: ICodecAPI,
    name: String,
    need_input: u32,
    frame_duration: i64,
    /// O SPS e o PPS que o encoder mandou, para o keyframe que vier sem eles (`h264.rs`).
    params: ParamSets,
    /// Quantas saídas já foram para o log (as primeiras vão, para diagnosticar uma placa).
    logged: u32,
    _manager: Option<IMFDXGIDeviceManager>,
}

impl MfEncoder {
    /// O encoder de hardware da placa de `gpu`, já configurado. Sem encoder de hardware nessa
    /// placa, falha: é o caso do plano B.
    ///
    /// Precisa do Media Foundation iniciado na thread (`MFStartup`, no `pipeline.rs`).
    pub fn new(
        gpu: &GpuDevice,
        settings: EncoderSettings,
        input: EncoderInput,
    ) -> Result<Self, AppError> {
        let (activate, name) = hardware_encoder(gpu.luid())?;

        // SAFETY: chamadas COM em interfaces válidas; os tipos de mídia e atributos são criados
        // aqui e vivem durante cada chamada.
        unsafe {
            let transform: IMFTransform =
                activate.ActivateObject().map_err(hr("ActivateObject"))?;
            let attributes = transform.GetAttributes().map_err(hr("GetAttributes"))?;
            attributes
                .SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1)
                .map_err(hr("MF_TRANSFORM_ASYNC_UNLOCK"))?;
            let _ = attributes.SetUINT32(&MF_LOW_LATENCY, 1);

            let manager = match input {
                EncoderInput::Gpu => {
                    let mut token = 0u32;
                    let mut manager = None;
                    MFCreateDXGIDeviceManager(&mut token, &mut manager)
                        .map_err(hr("MFCreateDXGIDeviceManager"))?;
                    let manager = manager.ok_or_else(|| {
                        AppError::VideoCapture("MFCreateDXGIDeviceManager sem o gerenciador".into())
                    })?;
                    manager
                        .ResetDevice(gpu.device(), token)
                        .map_err(hr("ResetDevice"))?;
                    transform
                        .ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, manager.as_raw() as usize)
                        .map_err(hr("MFT_MESSAGE_SET_D3D_MANAGER"))?;
                    Some(manager)
                }
                EncoderInput::Memory => None,
            };

            let codec_api: ICodecAPI = transform.cast().map_err(hr("ICodecAPI"))?;

            // Primeiro a codec API, depois os tipos (ver o começo do arquivo).
            configure(&codec_api, settings);

            let size = (u64::from(settings.width) << 32) | u64::from(settings.height);
            let rate = (u64::from(settings.fps) << 32) | 1;

            let output = MFCreateMediaType().map_err(hr("MFCreateMediaType"))?;
            output
                .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
                .map_err(hr("MF_MT_MAJOR_TYPE"))?;
            output
                .SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)
                .map_err(hr("MF_MT_SUBTYPE"))?;
            output
                .SetUINT32(&MF_MT_AVG_BITRATE, settings.bitrate_bps)
                .map_err(hr("MF_MT_AVG_BITRATE"))?;
            output
                .SetUINT64(&MF_MT_FRAME_SIZE, size)
                .map_err(hr("MF_MT_FRAME_SIZE"))?;
            output
                .SetUINT64(&MF_MT_FRAME_RATE, rate)
                .map_err(hr("MF_MT_FRAME_RATE"))?;
            output
                .SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1 << 32) | 1)
                .map_err(hr("MF_MT_PIXEL_ASPECT_RATIO"))?;
            output
                .SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
                .map_err(hr("MF_MT_INTERLACE_MODE"))?;
            output
                .SetUINT32(&MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_High.0 as u32)
                .map_err(hr("MF_MT_MPEG2_PROFILE"))?;
            // Sem o nível, o encoder pode escolher um que não comporta o fps (o 4.1 vai só até
            // 1080p30) e calcular o bitrate pelo fps máximo do nível.
            output
                .SetUINT32(
                    &MF_MT_MPEG2_LEVEL,
                    h264_level(settings.width, settings.height, settings.fps),
                )
                .map_err(hr("MF_MT_MPEG2_LEVEL"))?;
            transform
                .SetOutputType(0, &output, 0)
                .map_err(hr("SetOutputType"))?;

            let input = MFCreateMediaType().map_err(hr("MFCreateMediaType"))?;
            input
                .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
                .map_err(hr("MF_MT_MAJOR_TYPE"))?;
            input
                .SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)
                .map_err(hr("MF_MT_SUBTYPE"))?;
            input
                .SetUINT64(&MF_MT_FRAME_SIZE, size)
                .map_err(hr("MF_MT_FRAME_SIZE"))?;
            input
                .SetUINT64(&MF_MT_FRAME_RATE, rate)
                .map_err(hr("MF_MT_FRAME_RATE"))?;
            input
                .SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1 << 32) | 1)
                .map_err(hr("MF_MT_PIXEL_ASPECT_RATIO"))?;
            input
                .SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
                .map_err(hr("MF_MT_INTERLACE_MODE"))?;
            transform
                .SetInputType(0, &input, 0)
                .map_err(hr("SetInputType"))?;

            transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)
                .map_err(hr("MFT_MESSAGE_NOTIFY_BEGIN_STREAMING"))?;
            transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)
                .map_err(hr("MFT_MESSAGE_NOTIFY_START_OF_STREAM"))?;

            let events: IMFMediaEventGenerator =
                transform.cast().map_err(hr("IMFMediaEventGenerator"))?;
            let mut params = ParamSets::default();
            learn_sequence_header(&transform, &mut params);
            Ok(Self {
                transform,
                events,
                codec_api,
                name,
                need_input: 0,
                frame_duration: 10_000_000 / i64::from(settings.fps.max(1)),
                params,
                logged: 0,
                _manager: manager,
            })
        }
    }

    /// O nome do encoder no Media Foundation ("AMDh264Encoder"), para o painel e o log.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Se o encoder pediu entrada e ainda não recebeu.
    pub fn wants_input(&self) -> bool {
        self.need_input > 0
    }

    /// Processa os eventos pendentes sem bloquear: soma os pedidos de entrada e devolve as saídas.
    pub fn poll(&mut self) -> Result<Vec<EncodedOutput>, AppError> {
        let mut out = Vec::new();
        loop {
            // SAFETY: chamada COM em interface válida; `MF_EVENT_FLAG_NO_WAIT` nunca bloqueia.
            let event = match unsafe { self.events.GetEvent(MF_EVENT_FLAG_NO_WAIT) } {
                Ok(event) => event,
                Err(error) if error.code() == MF_E_NO_EVENTS_AVAILABLE => return Ok(out),
                Err(error) => return Err(hr("GetEvent")(error)),
            };
            // SAFETY: `event` é um IMFMediaEvent válido.
            let kind = MF_EVENT_TYPE(unsafe { event.GetType() }.map_err(hr("GetType"))? as i32);
            if kind == METransformNeedInput {
                self.need_input += 1;
            } else if kind == METransformHaveOutput {
                if let Some(output) = self.take_output()? {
                    out.push(output);
                }
            } else {
                // Um erro do encoder chega como evento (MEError), não como retorno: sem este log,
                // ele some e a transmissão só fica preta.
                // SAFETY: `event` é um IMFMediaEvent válido.
                let status = unsafe { event.GetStatus() }.map(|status| status.0);
                tracing::warn!(
                    target: "media",
                    evento = kind.0,
                    status = ?status.map(|code| format!("{:#010x}", code as u32)),
                    "evento inesperado do encoder de hardware"
                );
            }
        }
    }

    fn take_output(&mut self) -> Result<Option<EncodedOutput>, AppError> {
        let mut buffer = MFT_OUTPUT_DATA_BUFFER {
            dwStreamID: 0,
            pSample: ManuallyDrop::new(None),
            dwStatus: 0,
            pEvents: ManuallyDrop::new(None),
        };
        let mut status = 0u32;
        // SAFETY: os encoders de hardware alocam a amostra de saída, então `pSample` vai nulo; o
        // que vier em `pSample` e `pEvents` é solto logo abaixo.
        let result = unsafe {
            self.transform
                .ProcessOutput(0, std::slice::from_mut(&mut buffer), &mut status)
        };
        // SAFETY: cada ManuallyDrop é tomado ou solto uma única vez, aqui.
        let sample = unsafe { ManuallyDrop::take(&mut buffer.pSample) };
        // SAFETY: idem, para a coleção de eventos (normalmente nula).
        unsafe { ManuallyDrop::drop(&mut buffer.pEvents) };

        match result {
            Ok(()) => {}
            Err(error) if error.code() == MF_E_TRANSFORM_STREAM_CHANGE => {
                // O encoder mudou o formato da saída: aceitar o que ele propõe.
                // SAFETY: chamadas COM em interface válida.
                unsafe {
                    let proposed = self
                        .transform
                        .GetOutputAvailableType(0, 0)
                        .map_err(hr("GetOutputAvailableType"))?;
                    self.transform
                        .SetOutputType(0, &proposed, 0)
                        .map_err(hr("SetOutputType"))?;
                }
                learn_sequence_header(&self.transform, &mut self.params);
                tracing::info!(target: "media", "o encoder renegociou o formato da saída");
                return Ok(None);
            }
            Err(error) => return Err(hr("ProcessOutput")(error)),
        }

        let Some(sample) = sample else {
            return Ok(None);
        };
        // SAFETY: `sample` é uma IMFSample válida; o buffer é travado e destravado aqui, e os
        // bytes são copiados antes do `Unlock`.
        unsafe {
            let time = sample.GetSampleTime().unwrap_or(0);
            let keyframe = sample.GetUINT32(&MFSampleExtension_CleanPoint).unwrap_or(0) != 0;
            let media = sample
                .ConvertToContiguousBuffer()
                .map_err(hr("ConvertToContiguousBuffer"))?;
            let mut ptr = std::ptr::null_mut();
            let mut len = 0u32;
            media
                .Lock(&mut ptr, None, Some(&mut len))
                .map_err(hr("IMFMediaBuffer::Lock"))?;
            let data = std::slice::from_raw_parts(ptr, len as usize).to_vec();
            let _ = media.Unlock();
            if self.logged < FIRST_OUTPUTS_LOGGED {
                self.logged += 1;
                tracing::info!(
                    target: "media",
                    bytes = data.len(),
                    marcado_keyframe = keyframe,
                    nal = ?nal_types(&data),
                    inicio = ?&data[..data.len().min(8)],
                    "saída do encoder de hardware"
                );
            }
            let (data, keyframe) = self.params.fix(data, keyframe);
            Ok(Some(EncodedOutput {
                time,
                keyframe,
                data,
            }))
        }
    }

    /// Entrega uma textura NV12 ao encoder, com o horário da imagem (100 ns). Só chamar com
    /// [`MfEncoder::wants_input`].
    pub fn submit(&mut self, texture: &ID3D11Texture2D, time: i64) -> Result<(), AppError> {
        // SAFETY: a textura é do mesmo dispositivo dado ao encoder pelo gerenciador DXGI, e o anel
        // do conversor garante que ela não é reescrita enquanto o encoder a lê.
        unsafe {
            let buffer = MFCreateDXGISurfaceBuffer(&ID3D11Texture2D::IID, texture, 0, false)
                .map_err(hr("MFCreateDXGISurfaceBuffer"))?;
            if let Ok(two_d) = buffer.cast::<IMF2DBuffer>() {
                if let Ok(length) = two_d.GetContiguousLength() {
                    let _ = buffer.SetCurrentLength(length);
                }
            }
            let sample = MFCreateSample().map_err(hr("MFCreateSample"))?;
            sample.AddBuffer(&buffer).map_err(hr("AddBuffer"))?;
            sample.SetSampleTime(time).map_err(hr("SetSampleTime"))?;
            sample
                .SetSampleDuration(self.frame_duration)
                .map_err(hr("SetSampleDuration"))?;
            self.transform
                .ProcessInput(0, &sample, 0)
                .map_err(hr("ProcessInput"))?;
        }
        self.need_input = self.need_input.saturating_sub(1);
        Ok(())
    }

    /// Entrega uma imagem NV12 na memória (sem sobra no fim das linhas), com o horário da imagem
    /// (100 ns). Para o encoder aberto com [`EncoderInput::Memory`]; só chamar com
    /// [`MfEncoder::wants_input`].
    pub fn submit_memory(&mut self, nv12: &[u8], time: i64) -> Result<(), AppError> {
        // SAFETY: o buffer é travado, recebe a cópia dentro do tamanho que foi criado e é
        // destravado antes de ir para a amostra.
        unsafe {
            let len = nv12.len() as u32;
            let buffer = MFCreateMemoryBuffer(len).map_err(hr("MFCreateMemoryBuffer"))?;
            let mut ptr = std::ptr::null_mut();
            buffer
                .Lock(&mut ptr, None, None)
                .map_err(hr("IMFMediaBuffer::Lock"))?;
            std::ptr::copy_nonoverlapping(nv12.as_ptr(), ptr, nv12.len());
            let _ = buffer.Unlock();
            buffer
                .SetCurrentLength(len)
                .map_err(hr("SetCurrentLength"))?;
            let sample = MFCreateSample().map_err(hr("MFCreateSample"))?;
            sample.AddBuffer(&buffer).map_err(hr("AddBuffer"))?;
            sample.SetSampleTime(time).map_err(hr("SetSampleTime"))?;
            sample
                .SetSampleDuration(self.frame_duration)
                .map_err(hr("SetSampleDuration"))?;
            self.transform
                .ProcessInput(0, &sample, 0)
                .map_err(hr("ProcessInput"))?;
        }
        self.need_input = self.need_input.saturating_sub(1);
        Ok(())
    }

    /// O próximo frame sai como keyframe. Devolve se o encoder aceitou.
    pub fn force_keyframe(&self) -> bool {
        // SAFETY: chamada COM em interface válida, com um VARIANT local.
        unsafe {
            self.codec_api
                .SetValue(&CODECAPI_AVEncVideoForceKeyFrame, &u32_variant(1))
        }
        .is_ok()
    }

    /// Troca o bitrate no meio. Devolve se o encoder aceitou.
    pub fn set_bitrate(&self, bps: u32) -> bool {
        // SAFETY: chamada COM em interface válida, com um VARIANT local.
        unsafe {
            self.codec_api
                .SetValue(&CODECAPI_AVEncCommonMeanBitRate, &u32_variant(bps))
        }
        .is_ok()
    }
}

impl Drop for MfEncoder {
    fn drop(&mut self) {
        // SAFETY: chamadas COM em interface válida; os erros no encerramento são ignorados.
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

/// O primeiro encoder H.264 de hardware da placa `luid` que aceita NV12, e o nome dele.
///
/// O `MFTEnum2` com o `MFT_ENUM_ADAPTER_LUID` filtra pela placa: sem o filtro, um driver antigo
/// registrado sem a placa (o "NVIDIA fantasma" da Etapa 0) aparecia na lista e falhava ao ativar.
fn hardware_encoder(luid: u64) -> Result<(IMFActivate, String), AppError> {
    let input = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: MFVideoFormat_NV12,
    };
    let output = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: MFVideoFormat_H264,
    };
    // O LUID vai como os 8 bytes do struct LUID (LowPart e HighPart, little endian).
    let luid_bytes = luid_blob(luid);

    let mut list: *mut Option<IMFActivate> = std::ptr::null_mut();
    let mut count = 0u32;
    // SAFETY: os ponteiros apontam para variáveis locais; o MF aloca `list` com CoTaskMemAlloc, e
    // ele é liberado abaixo.
    unsafe {
        let mut attributes = None;
        MFCreateAttributes(&mut attributes, 1).map_err(hr("MFCreateAttributes"))?;
        let attributes = attributes
            .ok_or_else(|| AppError::VideoCapture("MFCreateAttributes sem atributos".into()))?;
        attributes
            .SetBlob(&MFT_ENUM_ADAPTER_LUID, &luid_bytes)
            .map_err(hr("MFT_ENUM_ADAPTER_LUID"))?;
        MFTEnum2(
            MFT_CATEGORY_VIDEO_ENCODER,
            MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
            Some(&input),
            Some(&output),
            &attributes,
            &mut list,
            &mut count,
        )
        .map_err(hr("MFTEnum2"))?;
    }

    let mut found = Vec::with_capacity(count as usize);
    for i in 0..count as usize {
        // SAFETY: `list` tem `count` elementos válidos; cada um é lido (movido) uma única vez.
        if let Some(activate) = unsafe { list.add(i).read() } {
            found.push(activate);
        }
    }
    // SAFETY: o vetor foi alocado pelo MF com CoTaskMemAlloc, e os elementos já foram movidos.
    unsafe { CoTaskMemFree(Some(list as *const _)) };

    let activate = found.into_iter().next().ok_or_else(|| {
        AppError::VideoCapture("esta placa não tem encoder H.264 de hardware".into())
    })?;
    let name = friendly_name(&activate).unwrap_or_else(|| "encoder sem nome".into());
    Ok((activate, name))
}

fn luid_blob(luid: u64) -> [u8; 8] {
    let low = (luid & 0xffff_ffff) as u32;
    let high = (luid >> 32) as u32;
    let mut bytes = [0u8; 8];
    bytes[..4].copy_from_slice(&low.to_le_bytes());
    bytes[4..].copy_from_slice(&high.to_le_bytes());
    bytes
}

fn friendly_name(activate: &IMFActivate) -> Option<String> {
    let mut value = PWSTR::null();
    let mut len = 0u32;
    // SAFETY: `value` recebe uma string alocada pelo MF, liberada logo abaixo.
    unsafe {
        activate
            .GetAllocatedString(&MFT_FRIENDLY_NAME_Attribute, &mut value, &mut len)
            .ok()?;
        let text = value.to_string().ok();
        CoTaskMemFree(Some(value.0 as *const _));
        text
    }
}

/// Baixa latência, CBR, o bitrate, sem B-frames e o GOP, pela codec API. Um valor recusado vai
/// para o log: o encoder ainda funciona, só com o padrão dele naquele ponto.
/// Guarda o SPS e o PPS que o encoder põe no tipo de mídia da saída, se puser: há driver que só
/// os manda ali, e não no keyframe.
fn learn_sequence_header(transform: &IMFTransform, params: &mut ParamSets) {
    // SAFETY: chamadas COM em interface válida; o buffer tem o tamanho que o próprio tipo deu.
    unsafe {
        let Ok(current) = transform.GetOutputCurrentType(0) else {
            return;
        };
        let Ok(size) = current.GetBlobSize(&MF_MT_MPEG_SEQUENCE_HEADER) else {
            return;
        };
        let mut header = vec![0u8; size as usize];
        if current
            .GetBlob(&MF_MT_MPEG_SEQUENCE_HEADER, &mut header, None)
            .is_ok()
        {
            tracing::info!(
                target: "media",
                bytes = header.len(),
                nal = ?nal_types(&header),
                "o encoder mandou o SPS e o PPS no tipo de mídia"
            );
            params.learn(&header);
        }
    }
}

fn configure(api: &ICodecAPI, settings: EncoderSettings) {
    let set = |name: &str, key: &GUID, value: VARIANT| {
        // SAFETY: `api` é a ICodecAPI de um encoder vivo; o VARIANT é local.
        if unsafe { api.SetValue(key, &value) }.is_err() {
            tracing::info!(target: "media", "o encoder recusou: {name}");
        }
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
        u32_variant(settings.bitrate_bps),
    );
    set(
        "sem B-frames",
        &CODECAPI_AVEncMPVDefaultBPictureCount,
        u32_variant(0),
    );
    set(
        "GOP",
        &CODECAPI_AVEncMPVGOPSize,
        u32_variant(settings.fps * GOP_SECONDS),
    );
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn luid_vai_como_o_struct_do_windows() {
        assert_eq!(
            luid_blob(0x0000_0001_0000_d5a3),
            [0xa3, 0xd5, 0, 0, 1, 0, 0, 0]
        );
    }
}
