//! O que o reconhecimento do jogo pergunta ao Windows: a janela em primeiro plano, o `.exe` e a
//! hora de início de um processo, se ele ainda existe, a pasta da Steam e a lista de programas
//! instalados.

use std::path::PathBuf;

use windows_sys::Win32::{
    Foundation::{CloseHandle, ERROR_NO_MORE_ITEMS, FILETIME, HANDLE, HWND},
    System::{
        Registry::{
            RegCloseKey, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER,
            HKEY_LOCAL_MACHINE, KEY_READ, RRF_RT_REG_SZ,
        },
        Threading::{
            GetExitCodeProcess, GetProcessTimes, OpenProcess, QueryFullProcessImageNameW,
            PROCESS_QUERY_LIMITED_INFORMATION,
        },
    },
    UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId},
};

use super::launchers::InstalledProgram;

/// O código de saída de um processo que ainda roda.
const STILL_ACTIVE: u32 = 259;

/// Um processo aberto com `PROCESS_QUERY_LIMITED_INFORMATION`, fechado ao sair do escopo.
struct Process(HANDLE);

impl Process {
    fn open(pid: u32) -> Option<Self> {
        // SAFETY: sem pré-condições; devolve nulo se o processo não existe ou não deixa abrir.
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        (!handle.is_null()).then_some(Self(handle))
    }

    fn path(&self) -> Option<String> {
        let mut buffer = vec![0u16; 1024];
        let mut size = buffer.len() as u32;
        // SAFETY: o handle está aberto; o buffer tem o tamanho que `size` diz, e a função escreve
        // nele no máximo esse tanto.
        let ok = unsafe { QueryFullProcessImageNameW(self.0, 0, buffer.as_mut_ptr(), &mut size) };
        (ok != 0 && size > 0).then(|| String::from_utf16_lossy(&buffer[..size as usize]))
    }

    /// Quando o processo abriu, em milissegundos desde 1970.
    fn started_ms(&self) -> Option<i64> {
        let zero = FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        };
        let (mut created, mut exited, mut kernel, mut user) = (zero, zero, zero, zero);
        // SAFETY: o handle está aberto; os quatro ponteiros apontam para variáveis locais.
        let ok =
            unsafe { GetProcessTimes(self.0, &mut created, &mut exited, &mut kernel, &mut user) };
        if ok == 0 {
            return None;
        }
        let ticks = (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime);
        // De 1601 (o FILETIME, em 100 ns) para 1970 em milissegundos.
        Some((ticks.saturating_sub(116_444_736_000_000_000) / 10_000) as i64)
    }

    fn running(&self) -> bool {
        let mut code = 0u32;
        // SAFETY: o handle está aberto; `code` é uma variável local.
        let ok = unsafe { GetExitCodeProcess(self.0, &mut code) };
        ok != 0 && code == STILL_ACTIVE
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        // SAFETY: o handle veio do `OpenProcess` e é fechado uma vez só.
        unsafe { CloseHandle(self.0) };
    }
}

/// O processo da janela em primeiro plano: o pid, o `.exe` e quando abriu.
pub fn foreground() -> Option<(u32, String, i64)> {
    // SAFETY: sem pré-condições; pode devolver nulo (nenhuma janela em foco).
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_null() {
        return None;
    }
    process_of_window(hwnd)
}

/// O `.exe` da janela `id` (o `HWND` da lista do seletor).
pub fn window_exe(id: u64) -> Option<String> {
    process_of_window(id as usize as HWND).map(|(_, exe, _)| exe)
}

fn process_of_window(hwnd: HWND) -> Option<(u32, String, i64)> {
    let mut pid = 0u32;
    // SAFETY: aceita um `HWND` que acabou de fechar (devolve 0); `pid` é uma variável local.
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    if pid == 0 {
        return None;
    }
    let process = Process::open(pid)?;
    Some((pid, process.path()?, process.started_ms().unwrap_or(0)))
}

/// Se o processo `pid`, aberto em `started_ms`, ainda roda (o mesmo pid pode voltar em outro
/// processo depois).
pub fn still_running(pid: u32, started_ms: i64) -> bool {
    Process::open(pid).is_some_and(|process| {
        process.running() && process.started_ms().is_none_or(|at| at == started_ms)
    })
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

/// Um texto do registro (`REG_SZ`), ou `None`.
fn registry_string(root: HKEY, key: &str, value: &str) -> Option<String> {
    let key = wide(key);
    let value = wide(value);
    let mut buffer = vec![0u16; 1024];
    let mut size = (buffer.len() * 2) as u32;
    // SAFETY: os textos terminam em zero e o buffer tem o tamanho, em bytes, que `size` diz.
    let status = unsafe {
        RegGetValueW(
            root,
            key.as_ptr(),
            value.as_ptr(),
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
    let text = String::from_utf16_lossy(&buffer[..len]);
    (!text.trim().is_empty()).then_some(text)
}

/// A pasta da Steam: a do registro ou, sem ela, a padrão, se existir.
pub fn steam_root() -> Option<PathBuf> {
    registry_string(HKEY_CURRENT_USER, r"Software\Valve\Steam", "SteamPath")
        .map(PathBuf::from)
        .or_else(|| Some(PathBuf::from(r"C:\Program Files (x86)\Steam")))
        .filter(|path| path.join("steamapps").is_dir())
}

/// As subchaves de `root\key`.
fn subkeys(root: HKEY, key: &str) -> Vec<String> {
    let path = wide(key);
    let mut handle: HKEY = std::ptr::null_mut();
    // SAFETY: o texto termina em zero; `handle` é um ponteiro de saída válido.
    if unsafe { RegOpenKeyExW(root, path.as_ptr(), 0, KEY_READ, &mut handle) } != 0 {
        return Vec::new();
    }
    let mut names = Vec::new();
    for index in 0.. {
        let mut name = [0u16; 256];
        let mut len = name.len() as u32;
        // SAFETY: a chave está aberta; o buffer tem o tamanho, em caracteres, que `len` diz; os
        // ponteiros opcionais são nulos.
        let status = unsafe {
            RegEnumKeyExW(
                handle,
                index,
                name.as_mut_ptr(),
                &mut len,
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if status == ERROR_NO_MORE_ITEMS {
            break;
        }
        if status == 0 {
            names.push(String::from_utf16_lossy(&name[..len as usize]));
        }
        if index > 10_000 {
            break;
        }
    }
    // SAFETY: a chave veio do `RegOpenKeyExW` e é fechada uma vez só.
    unsafe { RegCloseKey(handle) };
    names
}

/// Os programas da lista "Adicionar ou remover programas" (64 e 32 bits, do PC e da pessoa).
pub fn installed_programs() -> Vec<InstalledProgram> {
    const UNINSTALL: [(HKEY, &str); 3] = [
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
    ];
    let mut programs = Vec::new();
    for (root, key) in UNINSTALL {
        for sub in subkeys(root, key) {
            let path = format!(r"{key}\{sub}");
            let get = |value: &str| registry_string(root, &path, value);
            let (Some(name), Some(location)) = (get("DisplayName"), get("InstallLocation")) else {
                continue;
            };
            programs.push(InstalledProgram {
                name,
                location,
                publisher: get("Publisher").unwrap_or_default(),
            });
        }
    }
    programs
}
