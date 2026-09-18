// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
mod audio;

fn main() {
    #[cfg(target_os = "windows")]
    desktop_lib::run();
}
