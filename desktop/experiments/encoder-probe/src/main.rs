//! Etapa 0 do publicador nativo (v0.2.5): mede, na máquina de quem roda, o caminho
//! que a transmissão vai usar quando sair do WebView:
//!
//! ```text
//! WGC (textura D3D11) -> VideoProcessor (redução + BGRA→NV12, na GPU) -> MFT H.264 de hardware
//! ```
//!
//! Sem rede e sem LiveKit: o objetivo é responder se o encoder do Media Foundation entrega
//! latência, ritmo e controle (keyframe e bitrate) bons o bastante. O resultado sai no terminal,
//! e o vídeo codificado pode ir para um `.h264` para conferir a imagem.
//!
//! Projeto à parte do app (sem o libwebrtc), para compilar em segundos. Só roda no Windows.

#![warn(clippy::undocumented_unsafe_blocks)]

#[cfg(windows)]
mod probe;

#[cfg(windows)]
fn main() {
    if let Err(error) = probe::run() {
        eprintln!("\nerro: {error}");
        std::process::exit(1);
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("o encoder-probe só roda no Windows");
    std::process::exit(1);
}
