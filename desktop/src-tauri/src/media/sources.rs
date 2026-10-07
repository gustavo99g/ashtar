//! Tipos das fontes de captura (janelas/monitores) + entrada comum da listagem.
//!
//! Ponto de entrada comum: define os tipos públicos e as funções que o
//! resto do projeto chama. A implementação de verdade mora em
//! `platform/win32/sources/` (ou no equivalente de outra plataforma), nunca
//! é usada diretamente por fora daqui.

use serde::{Deserialize, Serialize};

use livekit::webrtc::desktop_capturer as dc;

use super::platform;
use crate::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "id", rename_all = "camelCase")]
pub enum SourceRef {
    Window(u64),
    Monitor(u64),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSource {
    pub source: SourceRef,
    pub title: String,
    pub process_id: Option<u32>,
    pub icon: Option<String>,
    pub monitor: Option<MonitorInfo>,
}

#[derive(Debug)]
pub struct WindowDetails {
    pub process_id: Option<u32>,
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub is_primary: bool,
}

/// Pede ao DesktopCapturer as fontes de um tipo, como pares (id, título).
///
/// # Bloqueia
///
/// Cria um DesktopCapturer e enumera suas fontes de forma sincrona.
fn capturer_sources(kind: dc::DesktopCaptureSourceType) -> Result<Vec<(u64, String)>, AppError> {
    let capturer = dc::DesktopCapturer::new(dc::DesktopCapturerOptions::new(kind))
        .ok_or_else(|| AppError::Internal("não foi possível criar o DesktopCapturer".into()))?;

    Ok(capturer
        .get_source_list()
        .into_iter()
        .map(|source| (source.id(), source.title()))
        .collect())
}

/// Lista os monitores e janelas que podem ser compartilhados.
///
/// O DesktopCapturer eh a fonte da verdade de quais fontes existem e de
/// seus ids (decisao 2 do docs/plans/v0.1-reorganizacao.md); a plataforma so complementa cada item
/// (PID, icone, geometria do monitor). Uma janela que a plataforma decide
/// esconder (window_details devolvendo None) simplesmente nao entra na lista.
///
/// # Bloqueia
///
/// Enumeracao e extracao de icones sao sincronas. Chamar dentro de
/// `spawn_blocking`.
pub fn list_capture_sources() -> Result<Vec<CaptureSource>, AppError> {
    let mut sources = Vec::new();

    let screens = capturer_sources(dc::DesktopCaptureSourceType::Screen)?;
    for (index, (id, _ttle)) in screens.into_iter().enumerate() {
        let monitor = platform::monitor_details(id);
        let is_primary = monitor.as_ref().is_some_and(|m| m.is_primary);

        let title = if is_primary {
            format!("Tela {} (principal)", index + 1)
        } else {
            format!("Tela {}", index + 1)
        };

        sources.push(CaptureSource {
            source: SourceRef::Monitor(id),
            title,
            process_id: None,
            icon: None,
            monitor,
        });
    }

    for (id, title) in capturer_sources(dc::DesktopCaptureSourceType::Window)? {
        let Some(details) = platform::window_details(id) else {
            continue;
        };

        sources.push(CaptureSource {
            source: SourceRef::Window(id),
            title,
            process_id: details.process_id,
            icon: details.icon,
            monitor: None,
        });
    }

    Ok(sources)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    #[ignore = "precisa de uma área de trabalho real"]
    fn imprime_fontes() {
        let start = Instant::now();
        let sources = list_capture_sources().expect("a listagem falhou");
        println!("{} fontes em {:?}\n", sources.len(), start.elapsed());

        for s in &sources {
            println!(
                "{} | {} | pid={:?} | icone={} | {:?}",
                serde_json::to_string(&s.source).unwrap(),
                s.title,
                s.process_id,
                s.icon.is_some(),
                s.monitor,
            );
        }
    }

    #[test]
    fn serializa_no_formato_do_frontend() {
        let source = CaptureSource {
            source: SourceRef::Monitor(0),
            title: "Tela 1 (principal)".into(),
            process_id: None,
            icon: None,
            monitor: Some(MonitorInfo {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
                is_primary: true,
            }),
        };

        let json = serde_json::to_value(&source).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "source": { "kind": "monitor", "id": 0 },
                "title": "Tela 1 (principal)",
                "processId": null,
                "icon": null,
                "monitor": { "x": 0, "y": 0, "width": 1920, "height": 1080, "isPrimary": true }
            })
        );
    }
}
