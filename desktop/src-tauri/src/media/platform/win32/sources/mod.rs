//! Implementação real da listagem/captura de fontes no Windows.

use crate::media::sources::{MonitorInfo, WindowDetails};

pub mod icon;
pub mod monitors;
pub mod thumbnail;
pub mod windows;

mod gdi;

pub fn window_details(_id: u64) -> Option<WindowDetails> {
    Some(WindowDetails {
        process_id: None,
        icon: None,
    })
}

pub fn monitor_details(_id: u64) -> Option<MonitorInfo> {
    None
}
