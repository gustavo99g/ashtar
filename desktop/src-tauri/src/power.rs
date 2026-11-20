//! O Windows voltando da suspensão (ADR 0030, decisão 10): avisa o app (`system-resumed`), que entra
//! de novo na voz na hora, sem esperar o LiveKit perceber que a conexão de antes morreu.
//!
//! Usa o `PowerRegisterSuspendResumeNotification` com um callback, sem janela: o Windows chama o
//! callback numa thread dele, e o callback só emite o evento.

use tauri::AppHandle;

/// Evento para o app, sem payload.
pub const SYSTEM_RESUMED: &str = "system-resumed";

#[cfg(windows)]
mod platform {
    use super::SYSTEM_RESUMED;
    use std::ffi::c_void;
    use std::sync::OnceLock;
    use tauri::{AppHandle, Emitter};
    use windows_sys::Win32::System::Power::{
        PowerRegisterSuspendResumeNotification, DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DEVICE_NOTIFY_CALLBACK, PBT_APMRESUMEAUTOMATIC,
    };

    static APP: OnceLock<AppHandle> = OnceLock::new();

    unsafe extern "system" fn on_power(
        _context: *const c_void,
        kind: u32,
        _setting: *const c_void,
    ) -> u32 {
        if kind == PBT_APMRESUMEAUTOMATIC {
            tracing::info!("o Windows voltou da suspensão");
            if let Some(app) = APP.get() {
                if let Err(error) = app.emit(SYSTEM_RESUMED, ()) {
                    tracing::warn!(%error, "não foi possível avisar o app da volta da suspensão");
                }
            }
        }
        0
    }

    pub fn watch(app: &AppHandle) {
        if APP.set(app.clone()).is_err() {
            return;
        }
        // O Windows guarda o ponteiro enquanto o registro vale (o app inteiro): fica vazado de propósito.
        let parameters = Box::leak(Box::new(DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
            Callback: Some(on_power),
            Context: std::ptr::null_mut(),
        }));
        let mut registration: *mut c_void = std::ptr::null_mut();
        // SAFETY: com `DEVICE_NOTIFY_CALLBACK`, o `recipient` é um DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS
        // válido, que vive o processo todo (vazado acima); `registration` é um ponteiro de saída válido.
        let result = unsafe {
            PowerRegisterSuspendResumeNotification(
                DEVICE_NOTIFY_CALLBACK,
                std::ptr::from_mut(parameters).cast(),
                &mut registration,
            )
        };
        if result != 0 {
            tracing::warn!(codigo = result, "não foi possível ouvir a volta da suspensão");
        }
    }
}

/// Começa a ouvir a volta da suspensão. Fora do Windows, não faz nada.
pub fn watch_resume(app: &AppHandle) {
    #[cfg(windows)]
    platform::watch(app);
    #[cfg(not(windows))]
    let _ = app;
}
