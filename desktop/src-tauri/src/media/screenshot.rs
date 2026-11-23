//! O print da transmissão (decisões 22 a 24 do plano da v0.8): da imagem (o quadro da própria
//! captura, em BGRA, ou o PNG que o app tirou do `<video>`) para a área de transferência e,
//! se a pessoa quiser, para um arquivo em `Imagens\Ashtar`.
//!
//! Aqui fica o que não depende do Windows: os formatos, a miniatura do aviso e o nome do arquivo.

use std::io::Cursor;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{ImageFormat, RgbaImage};

use crate::error::AppError;

/// A largura da miniatura do aviso "Print copiado".
const THUMB_WIDTH: u32 = 320;

/// Uma imagem em RGBA.
pub struct Shot(pub RgbaImage);

impl Shot {
    /// De BGRA sem sobra nas linhas (o quadro da captura).
    pub fn from_bgra(bgra: &[u8], width: u32, height: u32) -> Result<Self, AppError> {
        let (pixels, _) = bgra.as_chunks::<4>();
        let rgba: Vec<u8> = pixels
            .iter()
            .flat_map(|&[b, g, r, _]| [r, g, b, 255])
            .collect();
        RgbaImage::from_raw(width, height, rgba)
            .map(Self)
            .ok_or_else(|| AppError::Internal("o quadro veio com o tamanho errado".into()))
    }

    /// De um PNG em base64, com ou sem o `data:image/png;base64,` da frente.
    pub fn from_png_base64(text: &str) -> Result<Self, AppError> {
        let data = text.split_once(',').map_or(text, |(_, data)| data);
        let bytes = STANDARD
            .decode(data.trim())
            .map_err(|error| AppError::Internal(format!("o print não veio em base64: {error}")))?;
        let image = image::load_from_memory_with_format(&bytes, ImageFormat::Png)
            .map_err(|error| AppError::Internal(format!("o print não é um PNG: {error}")))?;
        Ok(Self(image.to_rgba8()))
    }

    pub fn png(&self) -> Result<Vec<u8>, AppError> {
        let mut out = Cursor::new(Vec::new());
        self.0
            .write_to(&mut out, ImageFormat::Png)
            .map_err(|error| AppError::Internal(format!("PNG do print: {error}")))?;
        Ok(out.into_inner())
    }

    /// O `CF_DIB` do Windows: um `BITMAPINFOHEADER` de 32 bits e as linhas de baixo para cima.
    pub fn dib(&self) -> Vec<u8> {
        let (width, height) = self.0.dimensions();
        let mut out = Vec::with_capacity(40 + (width * height * 4) as usize);
        out.extend_from_slice(&40u32.to_le_bytes()); // biSize
        out.extend_from_slice(&(width as i32).to_le_bytes());
        out.extend_from_slice(&(height as i32).to_le_bytes()); // positivo: de baixo para cima
        out.extend_from_slice(&1u16.to_le_bytes()); // biPlanes
        out.extend_from_slice(&32u16.to_le_bytes()); // biBitCount
        out.extend_from_slice(&0u32.to_le_bytes()); // BI_RGB
        out.extend_from_slice(&(width * height * 4).to_le_bytes());
        out.extend_from_slice(&[0; 16]); // resolução e paleta
        for row in self.0.rows().rev() {
            for pixel in row {
                let [r, g, b, a] = pixel.0;
                out.extend_from_slice(&[b, g, r, a]);
            }
        }
        out
    }

    /// A miniatura do aviso, em `data:image/jpeg;base64,...`.
    pub fn thumbnail(&self) -> Result<String, AppError> {
        let (width, height) = self.0.dimensions();
        let scale = f64::from(THUMB_WIDTH) / f64::from(width.max(1));
        let small = if scale < 1.0 {
            image::imageops::resize(
                &self.0,
                THUMB_WIDTH,
                ((f64::from(height) * scale).round() as u32).max(1),
                FilterType::Triangle,
            )
        } else {
            self.0.clone()
        };
        let rgb = image::DynamicImage::ImageRgba8(small).to_rgb8();
        let mut out = Vec::new();
        JpegEncoder::new_with_quality(&mut out, 80)
            .encode_image(&rgb)
            .map_err(|error| AppError::Internal(format!("miniatura do print: {error}")))?;
        Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(out)))
    }
}

/// O nome do arquivo sem o que o Windows não aceita: `juju 2026-11-22 21-40`.
pub fn file_stem(name: &str) -> String {
    let clean: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            c if c.is_control() => '-',
            c => c,
        })
        .collect();
    let clean = clean.trim().trim_end_matches('.').trim();
    if clean.is_empty() {
        "print".to_owned()
    } else {
        clean.chars().take(120).collect()
    }
}

/// `dir/stem.png`, ou `dir/stem (2).png` se já existir.
pub fn free_path(dir: &Path, stem: &str) -> PathBuf {
    let first = dir.join(format!("{stem}.png"));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}).png")))
        .find(|path| !path.exists())
        .expect("algum número está livre")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn o_dib_tem_o_cabecalho_e_as_linhas_de_baixo_para_cima() {
        // 1×2: em cima vermelho, embaixo azul (BGRA).
        let shot = Shot::from_bgra(&[0, 0, 255, 0, 255, 0, 0, 0], 1, 2).unwrap();
        let dib = shot.dib();
        assert_eq!(dib.len(), 40 + 8);
        assert_eq!(&dib[0..4], &40u32.to_le_bytes());
        assert_eq!(&dib[8..12], &2i32.to_le_bytes());
        // A primeira linha do DIB é a de baixo (azul), em BGRA, opaca.
        assert_eq!(&dib[40..44], &[255, 0, 0, 255]);
        assert_eq!(&dib[44..48], &[0, 0, 255, 255]);
    }

    #[test]
    fn o_png_vai_e_volta() {
        let shot = Shot::from_bgra(&[10, 20, 30, 0], 1, 1).unwrap();
        let text = format!(
            "data:image/png;base64,{}",
            STANDARD.encode(shot.png().unwrap())
        );
        let back = Shot::from_png_base64(&text).unwrap();
        assert_eq!(back.0.get_pixel(0, 0).0, [30, 20, 10, 255]);
        assert!(Shot::from_png_base64("lixo").is_err());
        assert!(shot
            .thumbnail()
            .unwrap()
            .starts_with("data:image/jpeg;base64,"));
    }

    #[test]
    fn o_nome_do_arquivo_nao_tem_o_que_o_windows_recusa() {
        assert_eq!(file_stem("juju 2026-11-22 21:40"), "juju 2026-11-22 21-40");
        assert_eq!(file_stem("a/b\\c?. "), "a-b-c-");
        assert_eq!(file_stem("  "), "print");

        let dir = std::env::temp_dir().join(format!("ashtar-print-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let first = free_path(&dir, "x");
        assert_eq!(first, dir.join("x.png"));
        std::fs::write(&first, b"").unwrap();
        assert_eq!(free_path(&dir, "x"), dir.join("x (2).png"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
