//! O microfone e a câmera sem pergunta.
//!
//! O WebView2 mostra o aviso de permissão do navegador na primeira vez que a sala pede o
//! microfone, e grava a resposta por origem. Quem nega (ou fecha o aviso sem querer) fica sem
//! microfone, sem um lugar óbvio para desfazer. Para um app de voz que a pessoa instalou, isso não
//! faz sentido: aqui o app responde "permitido" ao pedido de microfone e a pergunta não aparece.
//! Desde a v0.4 vale o mesmo para a câmera (ADR 0025): ela só liga pelo botão Câmera ou pela prévia
//! em Configurações, então a pessoa já pediu.
//!
//! Só o microfone e a câmera, e só para as páginas do próprio app ([`is_app_origin`]).
//! Localização e o resto seguem o comportamento normal do WebView2. As chaves "Permitir que
//! aplicativos da área de trabalho acessem o microfone" e "a câmera" do Windows (Privacidade)
//! continuam valendo: se estiverem desligadas, o sistema bloqueia de qualquer jeito.

use tauri::{App, Manager};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_CAMERA,
    COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
};
use webview2_com::PermissionRequestedEventHandler;

/// Se `uri` é uma página do próprio app: o Vite do `pnpm app:dev` (`localhost`) ou o endereço que o
/// Tauri dá ao frontend empacotado (`tauri.localhost`). Uma página de fora nunca ganha o microfone
/// nem a câmera.
pub fn is_app_origin(uri: &str) -> bool {
    let Some((scheme, rest)) = uri.split_once("://") else {
        return false;
    };
    // O host exato, sem a porta: `localhost.evil.com` e `localhost@evil.com` não passam.
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = authority.split(':').next().unwrap_or("");
    matches!(
        (scheme, host),
        ("http", "localhost") | ("http" | "https", "tauri.localhost")
    )
}

/// Registra a resposta automática ao pedido de microfone e de câmera na janela principal. Falhar só
/// deixa o aviso do WebView2 aparecer, como antes.
pub fn allow_media(app: &App) {
    let Some(window) = app.get_webview_window("main") else {
        tracing::warn!("sem janela principal para liberar o microfone e a câmera");
        return;
    };
    let registered = window.with_webview(|webview| {
        // SAFETY: roda na thread principal, com o controller que o Tauri acabou de entregar; o
        // `add_PermissionRequested` só guarda o handler, que fica vivo pelo WebView2.
        if let Err(error) = unsafe { register(&webview) } {
            tracing::warn!(%error, "não foi possível liberar o microfone e a câmera sem perguntar");
        }
    });
    if let Err(error) = registered {
        tracing::warn!(%error, "não foi possível acessar o WebView2 para liberar o microfone e a câmera");
    }
}

/// # Safety
///
/// Só na thread do WebView2, com o `controller` válido.
unsafe fn register(webview: &tauri::webview::PlatformWebview) -> windows::core::Result<()> {
    // SAFETY: o controller vem do Tauri e vale enquanto a janela existir.
    let core = unsafe { webview.controller().CoreWebView2()? };
    let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
        let Some(args) = args else {
            return Ok(());
        };
        // SAFETY: `args` é o objeto do evento, válido dentro desta chamada.
        unsafe {
            let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
            args.PermissionKind(&mut kind)?;
            if kind != COREWEBVIEW2_PERMISSION_KIND_MICROPHONE
                && kind != COREWEBVIEW2_PERMISSION_KIND_CAMERA
            {
                return Ok(());
            }
            let mut uri = windows::core::PWSTR::null();
            args.Uri(&mut uri)?;
            if is_app_origin(&webview2_com::take_pwstr(uri)) {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
            }
        }
        Ok(())
    }));
    let mut token = Default::default();
    // SAFETY: o handler fica vivo pelo WebView2 até a janela fechar.
    unsafe { core.add_PermissionRequested(&handler, &mut token) }
}

#[cfg(test)]
mod tests {
    use super::is_app_origin;

    #[test]
    fn as_paginas_do_app_ganham_o_microfone() {
        assert!(is_app_origin("http://localhost:1420/"));
        assert!(is_app_origin("http://tauri.localhost/"));
        assert!(is_app_origin("https://tauri.localhost/index.html"));
    }

    #[test]
    fn uma_pagina_de_fora_nunca_ganha() {
        assert!(!is_app_origin("https://example.com/"));
        assert!(!is_app_origin("https://localhost.example.com/"));
        assert!(!is_app_origin("http://tauri.localhost.evil.com/"));
        assert!(!is_app_origin("http://localhost@evil.com/"));
        assert!(!is_app_origin("ftp://localhost/"));
        assert!(!is_app_origin(""));
    }
}
