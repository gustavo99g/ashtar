//! Uma imagem só de uma fonte, no tamanho cheio: o print da própria transmissão (decisão 23 do
//! plano da v0.8). Abre uma captura do WGC só para isso, pega o primeiro quadro e fecha.

use std::time::{Duration, Instant};

use super::convert::{Converter, OutputFormat};
use super::gpu::GpuDevice;
use super::readback::Readback;
use super::wgc::{self, WgcCapture};
use crate::error::AppError;
use crate::media::sources::SourceRef;

/// Quanto esperar o primeiro quadro: uma janela minimizada nunca manda.
const WAIT: Duration = Duration::from_secs(2);

/// O tamanho de saída: par nas duas medidas, como o VideoProcessor gosta.
fn even((width, height): (u32, u32)) -> (u32, u32) {
    ((width & !1).max(2), (height & !1).max(2))
}

/// A imagem atual de `source` em BGRA, sem sobra nas linhas, com a largura e a altura.
///
/// # Bloqueia
///
/// Até o primeiro quadro chegar (no máximo [`WAIT`]). Só chamar dentro de `spawn_blocking`.
pub fn capture_still(source: SourceRef) -> Result<(Vec<u8>, u32, u32), AppError> {
    wgc::init_thread();
    let gpu = GpuDevice::new()?;
    let mut capture = WgcCapture::new(&gpu, source, false)?;
    let deadline = Instant::now() + WAIT;
    let mut converter: Option<Converter> = None;
    loop {
        let input = capture.size();
        if converter
            .as_ref()
            .is_none_or(|known| known.input_size() != input)
        {
            converter = Some(Converter::new(
                &gpu,
                input,
                even(input),
                OutputFormat::Bgra,
                1,
            )?);
        }
        let current = converter.as_ref().expect("acabou de ser criado");
        let stored = capture.latest(|frame| current.store(frame))?;
        if stored.is_some() && current.input_size() == capture.size() {
            let size = current.output_size();
            let readback = Readback::new(&gpu, size, OutputFormat::Bgra)?;
            let bgra = readback.read(&gpu, current.convert(0)?)?;
            return Ok((bgra, size.0, size.1));
        }
        if capture.is_closed() || Instant::now() >= deadline {
            return Err(AppError::VideoCapture(
                "a fonte não mandou nenhuma imagem".into(),
            ));
        }
        std::thread::sleep(Duration::from_millis(30));
    }
}
