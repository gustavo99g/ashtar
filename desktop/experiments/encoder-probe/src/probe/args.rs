//! Opções de linha de comando, sem dependência externa.

use std::path::PathBuf;

pub const HELP: &str = "\
encoder-probe: mede WGC -> VideoProcessor (NV12) -> H.264 de hardware do Media Foundation

USO
    cargo run --release -- [opções]

OPÇÕES
    --list               lista telas, adaptadores e encoders de hardware, e sai
    --monitor N          tela pelo índice do --list (padrão: a principal)
    --size LxA|native    caixa máxima da saída (padrão: 1920x1080); native = resolução da tela
    --fps N              quadros por segundo (padrão: 60)
    --bitrate KBPS       bitrate alvo em kbps (padrão: 8000)
    --seconds N          duração da medição (padrão: 20)
    --encoder N          encoder de hardware pelo índice do --list (padrão: o da placa do teste)
    --profile P          base | main | high (padrão: high)
    --keyframe-every S   pede um keyframe a cada S segundos, 0 desliga (padrão: 3)
    --no-bitrate-change  não troca o bitrate pela metade no meio da medição
    --only-new           só codifica quando o WGC entrega imagem nova (como o app faria)
    --out ARQUIVO        grava o H.264 (Annex B) para conferir no VLC/ffplay
    --help               esta ajuda
";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Size {
    Native,
    Box { width: u32, height: u32 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Profile {
    Baseline,
    Main,
    High,
}

#[derive(Debug, Clone)]
pub struct Args {
    pub list: bool,
    pub monitor: Option<usize>,
    pub size: Size,
    pub fps: u32,
    pub bitrate_kbps: u32,
    pub seconds: u32,
    pub encoder: Option<usize>,
    pub profile: Profile,
    pub keyframe_every_s: u32,
    pub bitrate_change: bool,
    pub only_new: bool,
    pub out: Option<PathBuf>,
}

impl Default for Args {
    fn default() -> Self {
        Self {
            list: false,
            monitor: None,
            size: Size::Box {
                width: 1920,
                height: 1080,
            },
            fps: 60,
            bitrate_kbps: 8000,
            seconds: 20,
            encoder: None,
            profile: Profile::High,
            keyframe_every_s: 3,
            bitrate_change: true,
            only_new: false,
            out: None,
        }
    }
}

/// Lê os argumentos. `Ok(None)` = foi pedido `--help` (a ajuda já foi impressa).
pub fn parse() -> Result<Option<Args>, String> {
    let mut args = Args::default();
    let mut it = std::env::args().skip(1);

    while let Some(flag) = it.next() {
        let mut value = |name: &str| {
            it.next()
                .ok_or_else(|| format!("{name} precisa de um valor"))
        };
        match flag.as_str() {
            "--help" | "-h" => {
                print!("{HELP}");
                return Ok(None);
            }
            "--list" => args.list = true,
            "--monitor" => args.monitor = Some(number(&value("--monitor")?)?),
            "--size" => args.size = size(&value("--size")?)?,
            "--fps" => args.fps = number(&value("--fps")?)?,
            "--bitrate" => args.bitrate_kbps = number(&value("--bitrate")?)?,
            "--seconds" => args.seconds = number(&value("--seconds")?)?,
            "--encoder" => args.encoder = Some(number(&value("--encoder")?)?),
            "--profile" => {
                args.profile = match value("--profile")?.as_str() {
                    "base" | "baseline" => Profile::Baseline,
                    "main" => Profile::Main,
                    "high" => Profile::High,
                    other => return Err(format!("perfil desconhecido: {other}")),
                }
            }
            "--keyframe-every" => args.keyframe_every_s = number(&value("--keyframe-every")?)?,
            "--no-bitrate-change" => args.bitrate_change = false,
            "--only-new" => args.only_new = true,
            "--out" => args.out = Some(PathBuf::from(value("--out")?)),
            other => return Err(format!("opção desconhecida: {other} (veja --help)")),
        }
    }

    if !(1..=240).contains(&args.fps) {
        return Err(format!("fps fora de 1..=240: {}", args.fps));
    }
    if args.seconds == 0 || args.bitrate_kbps == 0 {
        return Err("--seconds e --bitrate precisam ser maiores que zero".into());
    }
    Ok(Some(args))
}

fn number<T: std::str::FromStr>(text: &str) -> Result<T, String> {
    text.parse().map_err(|_| format!("número inválido: {text}"))
}

fn size(text: &str) -> Result<Size, String> {
    if text == "native" {
        return Ok(Size::Native);
    }
    let (w, h) = text
        .split_once(['x', 'X'])
        .ok_or_else(|| format!("tamanho inválido: {text} (use LxA, ex.: 1280x720)"))?;
    let (width, height) = (number(w)?, number(h)?);
    if width < 16 || height < 16 {
        return Err(format!("tamanho pequeno demais: {text}"));
    }
    Ok(Size::Box { width, height })
}

/// Tamanho final para caber na caixa, mantendo a proporção, sem ampliar e com lados pares
/// (a mesma regra do `fit_in_box` do app).
pub fn fit_in_box(width: u32, height: u32, size: Size) -> (u32, u32) {
    let (mw, mh) = match size {
        Size::Native => (width, height),
        Size::Box { width, height } => (width, height),
    };
    let (w, h, mw64, mh64) = (
        u64::from(width),
        u64::from(height),
        u64::from(mw),
        u64::from(mh),
    );
    let (w, h) = if w <= mw64 && h <= mh64 {
        (w, h)
    } else if w * mh64 > h * mw64 {
        (mw64, h * mw64 / w)
    } else {
        (w * mh64 / h, mh64)
    };
    let even = |side: u64| (side as u32 & !1).max(2);
    (even(w), even(h))
}
