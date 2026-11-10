//! As miniaturas ao vivo do seletor e da própria transmissão (ADR 0019): ponto de entrada comum.
//!
//! Uma captura do WGC por fonte pedida, reduzida na GPU para [`THUMB_SIZE`] e lida a
//! [`THUMB_FPS`]; só imagens novas viram JPEG. A implementação mora em `platform/`
//! (`win32/thumbnails.rs`). Janelas minimizadas não desenham nada: o seletor mostra o ícone.

use std::sync::mpsc;

use image::codecs::jpeg::JpegEncoder;
use image::ExtendedColorType;

use super::sources::SourceRef;
use super::{platform, CaptureHandle, SinkStatus};
use crate::error::AppError;

/// O tamanho de cada miniatura, com bordas pretas quando a fonte tem outra proporção.
pub const THUMB_SIZE: (u32, u32) = (480, 270);
/// Quantas vezes por segundo as miniaturas são lidas.
pub const THUMB_FPS: u32 = 8;
/// O máximo de fontes ao mesmo tempo: o seletor só pede as dos cards visíveis.
pub const MAX_SOURCES: usize = 24;
/// Qualidade do JPEG (0 a 100): o painel da transmissão mostra a miniatura grande, e abaixo disso
/// o texto e as bordas ganham blocos.
const JPEG_QUALITY: u8 = 80;

/// O que recebe cada miniatura nova. Devolver `Stop` encerra as miniaturas.
pub type OnThumbnail = Box<dyn FnMut(SourceRef, &[u8]) -> SinkStatus + Send + 'static>;

/// As miniaturas em andamento. Soltar o handle pede a parada.
pub struct ThumbnailsHandle {
    sources: mpsc::Sender<Vec<SourceRef>>,
    capture: CaptureHandle,
}

impl ThumbnailsHandle {
    /// Troca as fontes (o seletor rolou, ou mudou de aba). As que continuam não recomeçam.
    pub fn set_sources(&self, sources: Vec<SourceRef>) {
        let _ = self.sources.send(limit(sources));
    }

    /// # Bloqueia
    ///
    /// Até a thread terminar. Só chamar dentro de `spawn_blocking`.
    pub fn stop_and_join(self) {
        self.capture.stop_and_join();
    }
}

/// Começa as miniaturas de `sources`.
///
/// # Bloqueia
///
/// Até o dispositivo da GPU abrir. Só chamar dentro de `spawn_blocking`.
pub fn spawn_thumbnails(
    sources: Vec<SourceRef>,
    on_thumbnail: OnThumbnail,
) -> Result<ThumbnailsHandle, AppError> {
    let (tx, rx) = mpsc::channel();
    let capture = platform::spawn_thumbnails(limit(sources), rx, on_thumbnail)?;
    Ok(ThumbnailsHandle {
        sources: tx,
        capture,
    })
}

fn limit(mut sources: Vec<SourceRef>) -> Vec<SourceRef> {
    sources.dedup();
    sources.truncate(MAX_SOURCES);
    sources
}

/// BGRA sem sobra nas linhas para JPEG.
pub fn encode_jpeg(bgra: &[u8], width: u32, height: u32) -> Result<Vec<u8>, AppError> {
    let (pixels, _) = bgra.as_chunks::<4>();
    let rgb: Vec<u8> = pixels.iter().flat_map(|&[b, g, r, _]| [r, g, b]).collect();
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY)
        .encode(&rgb, width, height, ExtendedColorType::Rgb8)
        .map_err(|e| AppError::Internal(format!("JPEG da miniatura: {e}")))?;
    Ok(out)
}

/// A mensagem que vai pelo `Channel` do Tauri: o tipo da fonte (0 janela, 1 tela), o id (u64,
/// little endian) e o JPEG. Espelha o `thumbnails.ts`.
pub fn thumbnail_message(source: SourceRef, jpeg: &[u8]) -> Vec<u8> {
    let (kind, id) = match source {
        SourceRef::Window(id) => (0u8, id),
        SourceRef::Monitor(id) => (1u8, id),
    };
    let mut out = Vec::with_capacity(9 + jpeg.len());
    out.push(kind);
    out.extend_from_slice(&id.to_le_bytes());
    out.extend_from_slice(jpeg);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn o_jpeg_sai_com_as_cores_certas() {
        // 2×1: um pixel vermelho e um azul, em BGRA.
        let bgra = [0, 0, 255, 255, 255, 0, 0, 255];
        let jpeg = encode_jpeg(&bgra, 2, 1).unwrap();
        let decoded = image::load_from_memory(&jpeg).unwrap().to_rgb8();
        let red = decoded.get_pixel(0, 0);
        let blue = decoded.get_pixel(1, 0);
        assert!(red[0] > 150 && red[2] < 100, "{red:?}");
        assert!(blue[2] > 150 && blue[0] < 100, "{blue:?}");
    }

    #[test]
    fn a_mensagem_leva_o_tipo_e_o_id_na_frente() {
        let message = thumbnail_message(SourceRef::Monitor(0x0102), &[9, 9]);
        assert_eq!(message, [1, 2, 1, 0, 0, 0, 0, 0, 0, 9, 9]);
        assert_eq!(thumbnail_message(SourceRef::Window(7), &[])[0], 0);
    }

    /// A tela principal, pela GPU: a miniatura chega como JPEG de `THUMB_SIZE`, com o seletor
    /// trocando as fontes no meio, e a parada devolve a thread.
    #[test]
    #[ignore = "precisa de uma área de trabalho real"]
    fn miniatura_da_tela_principal_chega_em_jpeg() {
        use std::sync::mpsc;
        use std::time::Duration;

        let monitor = platform::list_monitors()
            .into_iter()
            .find(|m| m.info.is_primary)
            .expect("nenhuma tela principal");
        let screen = SourceRef::Monitor(monitor.id);

        let (tx, rx) = mpsc::channel();
        let handle = spawn_thumbnails(
            vec![screen],
            Box::new(move |source, jpeg| {
                let _ = tx.send((source, jpeg.to_vec()));
                SinkStatus::Continue
            }),
        )
        .expect("as miniaturas começam");

        let (source, jpeg) = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("a primeira miniatura");
        assert_eq!(source, screen);
        let image = image::load_from_memory(&jpeg).expect("JPEG válido");
        assert_eq!((image.width(), image.height()), THUMB_SIZE);
        println!("miniatura de {} bytes", jpeg.len());

        // Sem fontes, nada mais chega (depois de esvaziar o que já estava a caminho).
        handle.set_sources(Vec::new());
        std::thread::sleep(Duration::from_millis(500));
        while rx.try_recv().is_ok() {}
        assert!(rx.recv_timeout(Duration::from_millis(500)).is_err());
        handle.stop_and_join();
    }

    #[test]
    fn nunca_mais_que_o_maximo_nem_repetidas() {
        let many: Vec<_> = (0..40).map(SourceRef::Window).collect();
        assert_eq!(limit(many).len(), MAX_SOURCES);
        let repeated = vec![SourceRef::Window(1), SourceRef::Window(1)];
        assert_eq!(limit(repeated), [SourceRef::Window(1)]);
    }
}
