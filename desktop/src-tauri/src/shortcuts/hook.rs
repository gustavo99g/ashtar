//! O gancho de teclado e mouse do Windows (`WH_KEYBOARD_LL` e `WH_MOUSE_LL`, ADR 0029, decisão 5).
//!
//! O Windows chama os ganchos na thread que os instalou, de dentro do laço de mensagens dela. O
//! callback faz o mínimo, porque o Windows desliga um gancho que demora (uns 300 ms) e, enquanto
//! ele roda, o teclado do computador inteiro espera: traduz o evento, põe no canal e devolve a vez
//! com `CallNextHookEx`, sempre. Nunca segura a tecla (o `RegisterHotKey` seguraria).

use super::combo::{Input, MouseButton};
use super::Message;
use std::ptr::{null, null_mut};
use std::sync::mpsc::Sender;
use std::sync::OnceLock;
use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, GetKeyNameTextW, MapVirtualKeyW, MAPVK_VK_TO_VSC,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, SetWindowsHookExW, HC_ACTION, KBDLLHOOKSTRUCT, MSG,
    MSLLHOOKSTRUCT, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP, WM_MBUTTONDOWN,
    WM_MBUTTONUP, WM_SYSKEYDOWN, WM_SYSKEYUP, WM_XBUTTONDOWN, WM_XBUTTONUP,
};

/// O canal da thread dos atalhos. O callback do gancho não recebe contexto: fica aqui.
static SENDER: OnceLock<Sender<Message>> = OnceLock::new();

/// Instala os dois ganchos numa thread própria. Uma vez por processo.
pub fn install(sender: Sender<Message>) {
    if SENDER.set(sender).is_err() {
        return;
    }
    let spawned = std::thread::Builder::new()
        .name("ashtar-gancho".into())
        .spawn(|| {
            // SAFETY: `null` pede o módulo do próprio executável, que vive o processo todo.
            let module = unsafe { GetModuleHandleW(null()) };
            // SAFETY: os callbacks são `extern "system"` com a assinatura do `HOOKPROC`, e a thread
            // tem o laço de mensagens logo abaixo, que o Windows usa para chamá-los.
            let keyboard =
                unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(on_keyboard), module, 0) };
            // SAFETY: como o de cima.
            let mouse = unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(on_mouse), module, 0) };
            if keyboard.is_null() || mouse.is_null() {
                tracing::error!(
                    teclado = !keyboard.is_null(),
                    mouse = !mouse.is_null(),
                    "não foi possível instalar o gancho dos atalhos"
                );
            } else {
                tracing::info!("gancho dos atalhos instalado");
            }
            // SAFETY: `MSG` é um struct C simples, válido zerado.
            let mut message: MSG = unsafe { std::mem::zeroed() };
            // O laço só existe para o Windows chamar os ganchos; nenhuma janela recebe mensagens aqui.
            // SAFETY: `message` vive o laço inteiro; `null_mut()` pega as mensagens da thread.
            while unsafe { GetMessageW(&mut message, null_mut(), 0, 0) } > 0 {}
        });
    if let Err(error) = spawned {
        tracing::error!(%error, "não foi possível ligar a thread do gancho");
    }
}

fn send(input: Input, down: bool) {
    if let Some(sender) = SENDER.get() {
        let _ = sender.send(Message::Input(input, down));
    }
}

unsafe extern "system" fn on_keyboard(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        // SAFETY: com `HC_ACTION`, o `lparam` do `WH_KEYBOARD_LL` aponta um KBDLLHOOKSTRUCT válido
        // durante o callback.
        let info = unsafe { &*(lparam as *const KBDLLHOOKSTRUCT) };
        let down = match wparam as u32 {
            WM_KEYDOWN | WM_SYSKEYDOWN => Some(true),
            WM_KEYUP | WM_SYSKEYUP => Some(false),
            _ => None,
        };
        if let Some(down) = down {
            send(Input::Key(info.vkCode as u16), down);
        }
    }
    // SAFETY: repassa o evento como veio; o primeiro argumento é ignorado desde o Windows NT.
    unsafe { CallNextHookEx(null_mut(), code, wparam, lparam) }
}

unsafe extern "system" fn on_mouse(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        // O movimento do mouse chega aqui centenas de vezes por segundo: só os botões interessam.
        let event = match wparam as u32 {
            WM_MBUTTONDOWN => Some((MouseButton::Middle, true)),
            WM_MBUTTONUP => Some((MouseButton::Middle, false)),
            WM_XBUTTONDOWN | WM_XBUTTONUP => {
                // SAFETY: com `HC_ACTION`, o `lparam` do `WH_MOUSE_LL` aponta um MSLLHOOKSTRUCT
                // válido durante o callback.
                let info = unsafe { &*(lparam as *const MSLLHOOKSTRUCT) };
                // A palavra alta do `mouseData` diz qual botão lateral: 1 (XBUTTON1) ou 2.
                let button = match (info.mouseData >> 16) & 0xFFFF {
                    1 => Some(MouseButton::X1),
                    2 => Some(MouseButton::X2),
                    _ => None,
                };
                button.map(|button| (button, wparam as u32 == WM_XBUTTONDOWN))
            }
            _ => None,
        };
        if let Some((button, down)) = event {
            send(Input::Mouse(button), down);
        }
    }
    // SAFETY: como no teclado.
    unsafe { CallNextHookEx(null_mut(), code, wparam, lparam) }
}

/// A tecla está apertada agora, para o Windows.
pub fn is_key_down(key: u16) -> bool {
    // SAFETY: sem ponteiros; só lê o estado do teclado.
    let state = unsafe { GetAsyncKeyState(i32::from(key)) };
    (state as u16) & 0x8000 != 0
}

/// As teclas com o código de varredura estendido: sem o bit, o Windows dá o nome da tecla do
/// teclado numérico (a seta para cima viraria "8 (TECLADO NUMÉRICO)").
fn is_extended(key: u16) -> bool {
    matches!(
        key,
        0x21..=0x28 // Page Up, Page Down, End, Home, as setas
            | 0x2D | 0x2E // Insert, Delete
            | 0x6F // a barra do teclado numérico
            | 0x90 // Num Lock
            | 0xA3 | 0xA5 // o Ctrl e o Alt da direita
            | 0x5B | 0x5C | 0x5D // as teclas do Windows e a de menu
    )
}

/// O nome que o Windows dá à tecla no teclado de agora (o ABNT2 dá o "Ç"), pelo `GetKeyNameTextW`.
pub fn key_name(key: u16) -> String {
    // SAFETY: sem ponteiros; só converte o código.
    let scan = unsafe { MapVirtualKeyW(u32::from(key), MAPVK_VK_TO_VSC) };
    let mut lparam = (scan as i32) << 16;
    if is_extended(key) {
        lparam |= 1 << 24;
    }
    let mut buffer = [0u16; 64];
    // SAFETY: o buffer é válido e o tamanho passado é o dele.
    let length = unsafe { GetKeyNameTextW(lparam, buffer.as_mut_ptr(), buffer.len() as i32) };
    if length > 0 {
        let name = String::from_utf16_lossy(&buffer[..length as usize]);
        // O Windows dá os nomes em maiúsculas ("ESPAÇO"): só a primeira letra fica grande.
        let mut chars = name.chars();
        match chars.next() {
            Some(first) if name.chars().count() > 1 => first
                .to_uppercase()
                .chain(chars.flat_map(char::to_lowercase))
                .collect(),
            _ => name,
        }
    } else {
        format!("Tecla {key}")
    }
}
