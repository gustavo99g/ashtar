//! Tipos das fontes de captura (janelas/monitores) + entrada comum da listagem.
//!
//! Ponto de entrada comum: define os tipos públicos e as funções que o
//! resto do projeto chama. A implementação de verdade mora em
//! `platform/win32/sources/` (ou no equivalente de outra plataforma), nunca
//! é usada diretamente por fora daqui.

use serde::{Deserialize, Serialize};

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
