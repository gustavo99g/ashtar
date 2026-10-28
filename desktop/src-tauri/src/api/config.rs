//! O endereço da API e o código de acesso, gravados no app na hora do build (ADR 0013).
//!
//! São as mesmas variáveis do frontend (`desktop/src/lib/api/config.ts`): vêm do ambiente ou do
//! `.env` da raiz, pelo `build.rs`. O JavaScript não escolhe para onde o Rust manda a chave.
//! Mudou o `.env`: o próximo `pnpm tauri dev` recompila com o valor novo.

const API_URL: Option<&str> = option_env!("VITE_API_URL");
const ACCESS_CODE: Option<&str> = option_env!("VITE_ACCESS_CODE");

/// Só no desenvolvimento: a API local, como no frontend.
const DEV_API_URL: &str = "http://127.0.0.1:3000";

/// O endereço da API, sem barra no fim. `None` num app gerado sem `VITE_API_URL`.
pub fn api_url() -> Option<String> {
    resolve_api_url(API_URL, cfg!(debug_assertions))
}

/// O código de acesso para o `X-Access-Code`, se configurado. Sai na etapa 8.
pub fn access_code() -> Option<&'static str> {
    ACCESS_CODE.map(str::trim).filter(|code| !code.is_empty())
}

/// A regra do `apiUrl` do frontend: a variável, se tiver texto; senão, a API local só no
/// desenvolvimento (`dev`: o `pnpm tauri dev` compila em modo debug, o build de release não).
fn resolve_api_url(configured: Option<&str>, dev: bool) -> Option<String> {
    let configured = configured.map(str::trim).filter(|url| !url.is_empty());
    let base = configured.or(dev.then_some(DEV_API_URL))?;
    Some(base.trim_end_matches('/').to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usa_a_variavel_sem_a_barra_do_fim() {
        let url = resolve_api_url(Some(" https://casa.exemplo.ts.net/ "), false);
        assert_eq!(url.as_deref(), Some("https://casa.exemplo.ts.net"));
    }

    #[test]
    fn sem_a_variavel_so_o_desenvolvimento_cai_na_api_local() {
        assert_eq!(resolve_api_url(None, true).as_deref(), Some(DEV_API_URL));
        assert_eq!(
            resolve_api_url(Some("  "), true).as_deref(),
            Some(DEV_API_URL)
        );
        assert_eq!(resolve_api_url(None, false), None);
    }
}
