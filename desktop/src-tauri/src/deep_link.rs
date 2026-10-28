//! A entrada pelo link: `ashtar://invite/CÓDIGO` e `ashtar://recovery/CÓDIGO` (ADR 0013).
//!
//! O trabalho é de dois plugins, registrados no `lib.rs`:
//!
//! - o `tauri-plugin-single-instance` garante uma janela só. Aberto de novo (pelo link ou pelo
//!   menu Iniciar), o Windows cria um segundo processo, que entrega os argumentos ao primeiro e
//!   fecha antes de abrir janela;
//! - o `tauri-plugin-deep-link` lê o link dos argumentos, os do próprio processo ou os que o
//!   segundo processo entregou, e o passa ao frontend (`lib/tauri/deep-link.ts`).
//!
//! Aqui ficam só as duas coisas que o app faz por conta própria: trazer a janela para a frente
//! quando outro processo pede (`window::bring_to_front`) e gravar o esquema no registro do Windows a
//! cada abertura ([`register_schemes`]). O link em si não passa por aqui, nem vai para o log: o
//! código do convite vale como uma senha até ser usado. Quem lê e confere é o frontend
//! (`features/entry`).

use tauri::App;
use tauri_plugin_deep_link::DeepLinkExt;

/// Grava no registro do Windows (`HKCU\Software\Classes`) os esquemas do `tauri.conf.json`
/// (`ashtar`, ou `ashtar-dev` no app de desenvolvimento), apontando para este executável.
///
/// O instalador já grava, mas quem chegou à versão nova pelo auto-update pode não ter passado
/// por essa parte dele, e o app de desenvolvimento (`pnpm app:dev`) só fica registrado assim.
/// Falhar não impede o app de abrir: o link só não abre o Ashtar até a próxima tentativa.
pub fn register_schemes(app: &App) {
    match app.deep_link().register_all() {
        Ok(()) => tracing::info!("esquema do link registrado"),
        Err(error) => tracing::warn!(%error, "não foi possível registrar o esquema do link"),
    }
}
