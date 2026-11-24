//! O encoder da placa, qualquer que seja o caminho: o Media Foundation ou o AMF da AMD (plano
//! `v0.8-amf.md`). O `pipeline.rs` fala só com o [`HardwareEncoder`].

use windows::Win32::Graphics::Direct3D11::ID3D11Texture2D;

use super::amf::AmfEncoder;
use super::mf_encoder::{EncodedOutput, MfEncoder};
use crate::error::AppError;

pub enum HardwareEncoder {
    Mf(MfEncoder),
    Amf(AmfEncoder),
}

impl HardwareEncoder {
    /// O nome para o painel e o log ("AMDh264Encoder", "AMF").
    pub fn name(&self) -> &str {
        match self {
            Self::Mf(encoder) => encoder.name(),
            Self::Amf(encoder) => encoder.name(),
        }
    }

    /// Se vale mandar uma imagem agora. O AMF não avisa: ele responde na entrega
    /// ([`HardwareEncoder::submit`]).
    pub fn wants_input(&self) -> bool {
        match self {
            Self::Mf(encoder) => encoder.wants_input(),
            Self::Amf(_) => true,
        }
    }

    /// Entrega a textura NV12. Devolve se o encoder aceitou: o AMF cheio recusa, e a imagem se
    /// perde como um frame pulado.
    pub fn submit(&mut self, texture: &ID3D11Texture2D, time: i64) -> Result<bool, AppError> {
        match self {
            Self::Mf(encoder) => encoder.submit(texture, time).map(|()| true),
            Self::Amf(encoder) => encoder.submit(texture, time),
        }
    }

    pub fn poll(&mut self) -> Result<Vec<EncodedOutput>, AppError> {
        match self {
            Self::Mf(encoder) => encoder.poll(),
            Self::Amf(encoder) => encoder.poll(),
        }
    }

    pub fn force_keyframe(&self) -> bool {
        match self {
            Self::Mf(encoder) => encoder.force_keyframe(),
            Self::Amf(encoder) => encoder.force_keyframe(),
        }
    }

    pub fn set_bitrate(&self, bps: u32) -> bool {
        match self {
            Self::Mf(encoder) => encoder.set_bitrate(bps),
            Self::Amf(encoder) => encoder.set_bitrate(bps),
        }
    }
}
