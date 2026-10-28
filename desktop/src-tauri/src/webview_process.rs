//! O processo do WebView2 deste app, para a captura de áudio da tela inteira.
//!
//! A voz do grupo toca no WebView2 (o Chromium embutido), e a captura "Todo o sistema" não pode
//! levá-la junto: senão quem assiste ouve a própria voz de volta dentro da transmissão. O WASAPI
//! exclui uma árvore de processos, e o certo a excluir é o **processo-navegador que este WebView2
//! usa de fato** (`ICoreWebView2::BrowserProcessId`), não o `desktop.exe`.
//!
//! Os dois são o mesmo na maioria das vezes: o navegador é filho do app. Mas não sempre. O
//! WebView2 reaproveita o navegador que já está rodando para a mesma pasta de dados, então um que
//! sobrou de uma execução anterior (o app reabre logo depois de uma atualização, por exemplo)
//! não é filho do app novo, e excluir só o PID do app deixaria a chamada entrar na captura.
//!
//! O PID é lido na abertura e a cada início de compartilhamento. Se não der para lê-lo, a captura
//! cai no PID do app, como antes ([`exclude_target`]).

use std::sync::atomic::{AtomicU32, Ordering};

use tauri::{AppHandle, Manager};
use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};

/// O processo-navegador do WebView2; zero enquanto não foi lido.
static BROWSER_PID: AtomicU32 = AtomicU32::new(0);

/// O processo-navegador do WebView2, se já foi lido.
pub fn browser_pid() -> Option<u32> {
    match BROWSER_PID.load(Ordering::Acquire) {
        0 => None,
        pid => Some(pid),
    }
}

/// O processo que a captura da tela inteira exclui: o navegador do WebView2, ou o próprio app
/// quando ele não pôde ser lido.
pub fn exclude_target(own_pid: u32, webview_pid: Option<u32>) -> u32 {
    webview_pid.unwrap_or(own_pid)
}

/// Lê o PID do navegador do WebView2 e o guarda. Roda na thread da janela, então a leitura chega
/// um instante depois: quem inicia um compartilhamento já lê o valor da abertura.
pub fn refresh(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        tracing::warn!("sem janela principal para ler o processo do WebView2");
        return;
    };
    let read = window.with_webview(|webview| {
        let mut pid = 0;
        // SAFETY: roda na thread principal, com o controller que o Tauri entrega; só lê o PID.
        let result = unsafe {
            webview
                .controller()
                .CoreWebView2()
                .and_then(|core| core.BrowserProcessId(&mut pid))
        };
        match result {
            Ok(()) if pid != 0 => remember(pid),
            Ok(()) => tracing::warn!("o WebView2 não informou o processo do navegador"),
            Err(error) => tracing::warn!(%error, "não foi possível ler o processo do WebView2"),
        }
    });
    if let Err(error) = read {
        tracing::warn!(%error, "não foi possível acessar o WebView2 para ler o processo");
    }
}

fn remember(pid: u32) {
    let previous = BROWSER_PID.swap(pid, Ordering::AcqRel);
    let own = std::process::id();
    if parent_pid(pid) == Some(own) {
        if previous != pid {
            tracing::info!(own_pid = own, webview_pid = pid, "processo do WebView2");
        }
    } else {
        // O caso que a leitura do PID existe para cobrir: excluir o `desktop.exe` não bastaria.
        tracing::warn!(
            own_pid = own,
            webview_pid = pid,
            "o WebView2 deste app não é filho dele (sobrou de outra execução?); a captura de \
             áudio da tela inteira exclui o processo dele, e não o do app"
        );
    }
}

/// O processo que criou `pid`, se ele existe.
fn parent_pid(pid: u32) -> Option<u32> {
    // SAFETY: o snapshot é só leitura e fechado no fim; `entry` leva o `dwSize` que a API pede.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = None;
        let mut more = Process32FirstW(snapshot, &mut entry) != 0;
        while more {
            if entry.th32ProcessID == pid {
                found = Some(entry.th32ParentProcessID);
                break;
            }
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
        found
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exclui_o_navegador_do_webview_quando_se_sabe_qual_e() {
        assert_eq!(exclude_target(100, Some(200)), 200);
    }

    #[test]
    fn sem_o_pid_do_webview_cai_no_do_app() {
        assert_eq!(exclude_target(100, None), 100);
    }

    #[test]
    fn o_pai_do_processo_atual_e_achado() {
        let me = std::process::id();
        let parent = parent_pid(me).expect("o processo do teste tem um pai");
        assert_ne!(parent, me);
        assert_ne!(parent, 0);
    }

    #[test]
    fn um_pid_que_nao_existe_nao_tem_pai() {
        assert_eq!(parent_pid(u32::MAX), None);
    }
}
