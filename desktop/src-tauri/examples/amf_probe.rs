//! `amf-probe`: valida o encoder AMF da AMD fora do app (plano `docs/plans/v0.8-amf.md`).
//!
//! ```text
//! cargo run --example amf_probe --release -- [arquivo.h264] [quadros]
//! ```
//!
//! Codifica quadros de teste (uma faixa clara andando num fundo cinza) e grava o H.264 em
//! `amf-probe.h264` (ou no arquivo dado). O vídeo abre no VLC ou com `ffplay amf-probe.h264`.

fn main() {
    #[cfg(target_os = "windows")]
    {
        let mut args = std::env::args().skip(1);
        let out = args.next().unwrap_or_else(|| "amf-probe.h264".into());
        let frames = args.next().and_then(|n| n.parse().ok()).unwrap_or(120);
        match desktop_lib::amf_probe(std::path::Path::new(&out), frames) {
            Ok(summary) => println!("{summary}"),
            Err(error) => {
                eprintln!("amf-probe falhou: {error}");
                std::process::exit(1);
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    eprintln!("o amf-probe só roda no Windows");
}
