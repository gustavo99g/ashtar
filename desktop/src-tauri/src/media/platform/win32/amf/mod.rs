//! O encoder H.264 da AMD direto pelo AMF, sem o Media Foundation no meio (plano `v0.8-amf.md`).
//! É a reserva para as placas AMD em que o encoder do Media Foundation trava (a RX 7600).

mod encoder;
pub mod ffi;
mod probe;

pub use encoder::AmfEncoder;
pub use probe::run as probe;
