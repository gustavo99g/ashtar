//! O `amf-probe` (`examples/amf_probe.rs`): abre o [`AmfEncoder`], codifica alguns quadros de
//! teste e grava o H.264 num arquivo. Serve para validar a ligação com o AMF numa placa AMD antes
//! de ela entrar na transmissão: uma posição errada numa vtable derruba o probe, não o app.

use std::io::Write;
use std::path::Path;
use std::time::{Duration, Instant};

use windows::Win32::Graphics::Direct3D11::{
    ID3D11Texture2D, D3D11_BIND_RENDER_TARGET, D3D11_SUBRESOURCE_DATA, D3D11_TEXTURE2D_DESC,
    D3D11_USAGE_DEFAULT,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_NV12, DXGI_SAMPLE_DESC};

use super::AmfEncoder;
use crate::error::AppError;
use crate::media::platform::win32::gpu::GpuDevice;
use crate::media::platform::win32::hr::hr;
use crate::media::platform::win32::mf_encoder::{EncodedOutput, EncoderSettings};

const WIDTH: u32 = 1280;
const HEIGHT: u32 = 720;
const FPS: u32 = 60;
/// Quantas imagens diferentes o probe alterna (uma faixa clara que anda pela tela).
const PATTERNS: u32 = 8;
/// Quanto o probe espera pelas últimas saídas depois do último quadro.
const TAIL: Duration = Duration::from_secs(2);

/// Codifica `frames` quadros e grava o H.264 (Annex B) em `out`. Devolve um resumo para a tela.
pub fn run(out: &Path, frames: u32) -> Result<String, AppError> {
    let gpu = GpuDevice::new()?;
    let name = gpu.adapter_name().to_owned();
    if !(name.contains("AMD") || name.contains("Radeon")) {
        return Err(AppError::VideoCapture(format!(
            "a placa padrão não é AMD ({name}): o AMF só roda na AMD"
        )));
    }

    let settings = EncoderSettings {
        width: WIDTH,
        height: HEIGHT,
        fps: FPS,
        bitrate_bps: 6_000_000,
    };
    let opened = Instant::now();
    let mut encoder = AmfEncoder::new(&gpu, settings)?;
    let open_time = opened.elapsed();
    let textures = (0..PATTERNS)
        .map(|n| pattern(&gpu, n))
        .collect::<Result<Vec<_>, _>>()?;

    let file = std::fs::File::create(out)
        .map_err(|error| AppError::VideoCapture(format!("{}: {error}", out.display())))?;
    let frame = 10_000_000 / i64::from(FPS);
    let mut tally = Tally {
        file,
        started: Instant::now(),
        first_output: None,
        outputs: 0,
        keyframes: 0,
        bytes: 0,
    };
    let mut full = 0u32;
    let mut bitrate_refused = false;

    for n in 0..frames {
        if n == frames / 2 {
            encoder.force_keyframe();
        }
        if n == frames * 3 / 4 && !encoder.set_bitrate(3_000_000) {
            bitrate_refused = true;
        }
        let texture = &textures[(n % PATTERNS) as usize];
        let time = i64::from(n) * frame;
        // Cheio: espera o encoder abrir espaço, no máximo um quadro.
        let deadline = Instant::now() + Duration::from_millis(16);
        while !encoder.submit(texture, time)? {
            full += 1;
            tally.add(encoder.poll()?)?;
            if Instant::now() > deadline {
                break;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        tally.add(encoder.poll()?)?;
    }
    let tail = Instant::now();
    while tail.elapsed() < TAIL {
        tally.add(encoder.poll()?)?;
        std::thread::sleep(Duration::from_millis(5));
    }
    let Tally {
        started,
        first_output,
        outputs,
        keyframes,
        bytes,
        ..
    } = tally;
    let total = started.elapsed();
    Ok(format!(
        "placa: {name} ({encoder_name})\n\
         trocar o bitrate no meio: {bitrate}\n\
         abrir o encoder: {open_time:?}\n\
         quadros enviados: {frames} ({full} vezes cheio)\n\
         saídas: {outputs} ({keyframes} keyframes, {bytes} bytes)\n\
         primeira saída: {first_output:?}\n\
         tempo total: {total:?}\n\
         arquivo: {}",
        out.display(),
        encoder_name = encoder.name(),
        bitrate = if bitrate_refused { "recusado" } else { "ok" },
    ))
}

/// O que saiu do encoder, já gravado no arquivo.
struct Tally {
    file: std::fs::File,
    started: Instant,
    first_output: Option<Duration>,
    outputs: u32,
    keyframes: u32,
    bytes: usize,
}

impl Tally {
    fn add(&mut self, encoded: Vec<EncodedOutput>) -> Result<(), AppError> {
        for output in encoded {
            let started = self.started;
            self.first_output.get_or_insert_with(|| started.elapsed());
            self.outputs += 1;
            self.keyframes += u32::from(output.keyframe);
            self.bytes += output.data.len();
            self.file
                .write_all(&output.data)
                .map_err(|error| AppError::VideoCapture(format!("gravar: {error}")))?;
        }
        Ok(())
    }
}

/// Uma imagem NV12 cinza com uma faixa clara na posição `n` de [`PATTERNS`].
fn pattern(gpu: &GpuDevice, n: u32) -> Result<ID3D11Texture2D, AppError> {
    let (w, h) = (WIDTH as usize, HEIGHT as usize);
    let mut data = vec![128u8; w * h * 3 / 2];
    let band = w / PATTERNS as usize;
    let start = band * n as usize;
    for row in data[..w * h].chunks_exact_mut(w) {
        row[..start].fill(60);
        row[start..start + band].fill(220);
        row[start + band..].fill(60);
    }
    let desc = D3D11_TEXTURE2D_DESC {
        Width: WIDTH,
        Height: HEIGHT,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_NV12,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: D3D11_BIND_RENDER_TARGET.0 as u32,
        CPUAccessFlags: 0,
        MiscFlags: 0,
    };
    // No NV12, os dados iniciais são o plano Y seguido do UV, com a mesma largura de linha.
    let initial = D3D11_SUBRESOURCE_DATA {
        pSysMem: data.as_ptr().cast(),
        SysMemPitch: WIDTH,
        SysMemSlicePitch: 0,
    };
    let mut texture = None;
    // SAFETY: `desc` e `initial` são válidos e vivos durante a chamada; `data` tem o tamanho de
    // uma imagem NV12 inteira com a largura de linha dada.
    unsafe {
        gpu.device()
            .CreateTexture2D(&desc, Some(&initial), Some(&mut texture))
    }
    .map_err(hr("CreateTexture2D"))?;
    texture.ok_or_else(|| AppError::VideoCapture("CreateTexture2D sem textura".into()))
}
