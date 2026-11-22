//! Tipos das fontes de captura (janelas/monitores) + entrada comum da listagem.
//!
//! Ponto de entrada comum: define os tipos públicos e as funções que o
//! resto do projeto chama. A implementação de verdade mora em
//! `platform/win32/sources/` (ou no equivalente de outra plataforma), nunca
//! é usada diretamente por fora daqui.

use serde::{Deserialize, Serialize};

use super::platform;
use crate::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
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
    /// Janela minimizada: aparece no seletor com o selo, e escolhê-la a restaura.
    pub minimized: bool,
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

/// Uma janela que pode ser compartilhada, como a plataforma a lista.
pub struct WindowEntry {
    pub id: u64,
    pub title: String,
    pub process_id: u32,
    pub minimized: bool,
    pub icon: Option<String>,
}

/// Uma tela, com a posição para o desenho do seletor (`monitorLayout.ts`).
pub struct MonitorEntry {
    pub id: u64,
    pub info: MonitorInfo,
}

/// O que o filtro de janelas precisa saber de uma janela (`platform::list_windows`).
#[derive(Debug, Clone, Default)]
pub struct WindowFacts {
    pub title: String,
    pub process_id: u32,
    /// `IsWindowVisible`. Uma janela minimizada continua visível.
    pub visible: bool,
    pub minimized: bool,
    /// Escondida pelo DWM (`DWMWA_CLOAKED`): apps da loja suspensos, janelas de outras áreas de
    /// trabalho virtuais.
    pub cloaked: bool,
    /// `WS_EX_TOOLWINDOW`: paletas e janelas flutuantes, que o Alt + Tab não mostra.
    pub tool_window: bool,
    /// `WS_EX_APPWINDOW`: a janela pede para aparecer na barra de tarefas, mesmo com dono.
    pub app_window: bool,
    /// Tem uma janela dona (caixas de diálogo, janelas secundárias).
    pub has_owner: bool,
    /// A janela da área de trabalho ("Program Manager").
    pub is_shell: bool,
    /// Do próprio Ashtar: compartilhá-la com o áudio levaria as vozes da chamada.
    pub own_process: bool,
}

/// Se a janela entra no seletor: a mesma regra do Alt + Tab, inclusive para as minimizadas.
pub fn is_shareable(window: &WindowFacts) -> bool {
    if !window.visible || window.cloaked || window.is_shell || window.own_process {
        return false;
    }
    if window.title.trim().is_empty() {
        return false;
    }
    window.app_window || (!window.tool_window && !window.has_owner)
}

/// Lista as telas e as janelas que dá para compartilhar pela captura própria (WGC): as telas
/// primeiro, depois as janelas na ordem do Alt + Tab, inclusive as minimizadas (ADR 0019).
///
/// Os ids são o `HMONITOR` e o `HWND`, que é o que a captura recebe.
///
/// # Bloqueia
///
/// A enumeração e os ícones são síncronos. Chamar dentro de `spawn_blocking`.
pub fn list_sources() -> Result<Vec<CaptureSource>, AppError> {
    let monitors = platform::list_monitors();
    let mut sources: Vec<CaptureSource> = monitors
        .into_iter()
        .enumerate()
        .map(|(index, monitor)| CaptureSource {
            source: SourceRef::Monitor(monitor.id),
            title: if monitor.info.is_primary {
                format!("Tela {} (principal)", index + 1)
            } else {
                format!("Tela {}", index + 1)
            },
            process_id: None,
            icon: None,
            monitor: Some(monitor.info),
            minimized: false,
        })
        .collect();

    sources.extend(
        platform::list_windows()
            .into_iter()
            .map(|window| CaptureSource {
                source: SourceRef::Window(window.id),
                title: window.title,
                process_id: Some(window.process_id),
                icon: window.icon,
                monitor: None,
                minimized: window.minimized,
            }),
    );
    Ok(sources)
}

/// O ícone de um `.exe` em PNG, até `size` pixels (o do jogo detectado, ADR 0033). Bloqueia: lê o
/// disco.
pub fn exe_icon_png(path: &str, size: u32) -> Option<Vec<u8>> {
    platform::exe_icon_png(path, size)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    /// Uma janela comum de um app: visível, com título, sem dono.
    fn app_window() -> WindowFacts {
        WindowFacts {
            title: "Bloco de Notas".into(),
            process_id: 42,
            visible: true,
            ..WindowFacts::default()
        }
    }

    #[test]
    fn janela_comum_e_minimizada_entram() {
        assert!(is_shareable(&app_window()));
        assert!(is_shareable(&WindowFacts {
            minimized: true,
            ..app_window()
        }));
    }

    #[test]
    fn escondidas_sem_titulo_e_do_app_ficam_fora() {
        for window in [
            WindowFacts {
                visible: false,
                ..app_window()
            },
            WindowFacts {
                cloaked: true,
                ..app_window()
            },
            WindowFacts {
                is_shell: true,
                ..app_window()
            },
            WindowFacts {
                own_process: true,
                ..app_window()
            },
            WindowFacts {
                title: "   ".into(),
                ..app_window()
            },
        ] {
            assert!(!is_shareable(&window), "{window:?}");
        }
    }

    #[test]
    fn ferramenta_e_dialogo_so_entram_se_pedirem_a_barra_de_tarefas() {
        let tool = WindowFacts {
            tool_window: true,
            ..app_window()
        };
        let dialog = WindowFacts {
            has_owner: true,
            ..app_window()
        };
        assert!(!is_shareable(&tool));
        assert!(!is_shareable(&dialog));
        assert!(is_shareable(&WindowFacts {
            app_window: true,
            ..tool
        }));
        assert!(is_shareable(&WindowFacts {
            app_window: true,
            ..dialog
        }));
    }

    #[test]
    #[ignore = "precisa de uma área de trabalho real"]
    fn imprime_a_lista_nova() {
        let start = Instant::now();
        let sources = list_sources().expect("a listagem falhou");
        println!("{} fontes em {:?}\n", sources.len(), start.elapsed());
        for s in &sources {
            println!(
                "{} | {} | minimizada={} | ícone={}",
                serde_json::to_string(&s.source).unwrap(),
                s.title,
                s.minimized,
                s.icon.is_some(),
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
            minimized: false,
        };

        let json = serde_json::to_value(&source).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "source": { "kind": "monitor", "id": 0 },
                "title": "Tela 1 (principal)",
                "processId": null,
                "icon": null,
                "monitor": { "x": 0, "y": 0, "width": 1920, "height": 1080, "isPrimary": true },
                "minimized": false
            })
        );
    }
}
