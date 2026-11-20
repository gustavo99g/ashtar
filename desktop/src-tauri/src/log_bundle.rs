//! O "Enviar logs" (v0.6, decisão 16): os arquivos de log dos últimos 2 dias e um `info.txt` (a
//! versão do app, do Windows e a placa de vídeo) num `.zip` na memória, que o app manda para a API.
//! Os logs não têm mensagens, mas têm nicks e ids; só o dono os vê.

use std::io::{Cursor, Write};
use std::path::Path;
use std::time::{Duration, SystemTime};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::error::AppError;

/// Os logs de até este tempo atrás entram.
pub const RECENT: Duration = Duration::from_secs(2 * 24 * 60 * 60);
/// O `.zip` não pode passar disto (o limite da API). Com logs maiores, ficam os mais novos.
pub const MAX_ZIP: usize = 10 * 1024 * 1024;

/// Junta os `ashtar.*.log` de `dir` mudados desde `now - RECENT`, do mais novo para o mais antigo, e
/// o `info`, num `.zip`. Um arquivo que deixaria o `.zip` grande demais fica de fora.
pub fn bundle(dir: &Path, now: SystemTime, info: &str) -> Result<Vec<u8>, AppError> {
    let since = now.checked_sub(RECENT).unwrap_or(SystemTime::UNIX_EPOCH);
    let mut files: Vec<(SystemTime, std::path::PathBuf)> = std::fs::read_dir(dir)
        .map_err(|error| AppError::Internal(format!("pasta de logs: {error}")))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with("ashtar.") && name.ends_with(".log"))
        })
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            (modified >= since).then(|| (modified, entry.path()))
        })
        .collect();
    files.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));

    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let fail = |error: zip::result::ZipError| AppError::Internal(format!("zip: {error}"));
    zip.start_file("info.txt", options).map_err(fail)?;
    zip.write_all(info.as_bytes())
        .map_err(|error| AppError::Internal(format!("zip: {error}")))?;

    // A compressão do texto dá uns 10 para 1; conta pelo tamanho cru, com folga.
    let mut budget = MAX_ZIP.saturating_mul(4);
    for (_, path) in files {
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        if bytes.len() > budget {
            continue;
        }
        budget -= bytes.len();
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        zip.start_file(name, options).map_err(fail)?;
        zip.write_all(&bytes)
            .map_err(|error| AppError::Internal(format!("zip: {error}")))?;
    }
    let bytes = zip.finish().map_err(fail)?.into_inner();
    if bytes.len() > MAX_ZIP {
        return Err(AppError::Internal(
            "os logs passam de 10 MB mesmo comprimidos".into(),
        ));
    }
    Ok(bytes)
}

/// O texto do `info.txt`.
pub fn info(app_version: &str, windows: Option<String>, gpu: Option<String>) -> String {
    format!(
        "Ashtar {app_version}\nWindows: {}\nPlaca de vídeo: {}\n",
        windows.as_deref().unwrap_or("?"),
        gpu.as_deref().unwrap_or("?"),
    )
}

/// "Windows 11 Pro 24H2 (26100)", do registro.
#[cfg(target_os = "windows")]
pub fn windows_version() -> Option<String> {
    let product = registry_string("ProductName")?;
    // O `ProductName` ainda diz "Windows 10" no 11: o número da build decide.
    let build = registry_string("CurrentBuild");
    let product = match build.as_deref().and_then(|b| b.parse::<u32>().ok()) {
        Some(number) if number >= 22000 => product.replacen("Windows 10", "Windows 11", 1),
        _ => product,
    };
    let display = registry_string("DisplayVersion");
    Some(
        [Some(product), display, build.map(|b| format!("({b})"))]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" "),
    )
}

#[cfg(not(target_os = "windows"))]
pub fn windows_version() -> Option<String> {
    None
}

#[cfg(target_os = "windows")]
fn registry_string(value: &str) -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};

    let wide = |text: &str| text.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let key = wide(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
    let name = wide(value);
    let mut buffer = [0u16; 256];
    let mut size = std::mem::size_of_val(&buffer) as u32;
    // SAFETY: os textos terminam em zero e o buffer tem o tamanho que `size` diz.
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buffer.as_mut_ptr().cast(),
            &mut size,
        )
    };
    if status != 0 {
        return None;
    }
    let len = (size as usize / 2).saturating_sub(1).min(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..len]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn junta_os_logs_recentes_e_o_info() {
        let dir = std::env::temp_dir().join(format!("ashtar-bundle-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("ashtar.2026-11-20.log"), "linha de hoje").unwrap();
        std::fs::write(dir.join("outra.txt"), "fora").unwrap();

        let bytes = bundle(&dir, SystemTime::now(), "Ashtar 0.6.0\n").unwrap();
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut names: Vec<_> = zip
            .file_names()
            .map(|name| name.unwrap().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, ["ashtar.2026-11-20.log", "info.txt"]);
        let mut text = String::new();
        zip.by_name("ashtar.2026-11-20.log")
            .unwrap()
            .read_to_string(&mut text)
            .unwrap();
        assert_eq!(text, "linha de hoje");

        // Daqui a 3 dias, o de hoje já não é recente.
        let later = SystemTime::now() + Duration::from_secs(3 * 24 * 60 * 60);
        let zip = zip::ZipArchive::new(Cursor::new(bundle(&dir, later, "").unwrap())).unwrap();
        assert_eq!(zip.len(), 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
