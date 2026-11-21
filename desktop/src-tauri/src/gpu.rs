//! A aceleração de hardware da janela (Configurações › Aplicativo, v0.7): desligada, o WebView2
//! abre com `--disable-gpu` e desenha tudo na CPU. Serve para testar se a placa de vídeo livre
//! muda alguma coisa num jogo aberto junto.
//!
//! O WebView2 lê os argumentos ao nascer, antes de o Tauri saber das pastas do app. Por isso a
//! escolha é um arquivo vazio na pasta de configuração (`%APPDATA%\<identificador>`), que o
//! [`disabled_at_start`] procura pelo caminho de sempre. Vale ao reiniciar o app.
//!
//! A transmissão de tela não passa por aqui: ela tem a própria escolha do encoder.

use std::path::{Path, PathBuf};

/// O arquivo que diz "sem aceleração". Existe ou não; o conteúdo não importa.
const FILE: &str = "sem-aceleracao-de-hardware";

/// Onde fica o arquivo, na pasta de configuração do app.
pub fn flag_path(config_dir: &Path) -> PathBuf {
    config_dir.join(FILE)
}

/// Se a aceleração foi desligada, olhando antes do Tauri. A pasta é a mesma do `app_config_dir`
/// do Tauri no Windows: `%APPDATA%\<identificador>`.
pub fn disabled_at_start(identifier: &str) -> bool {
    std::env::var_os("APPDATA")
        .map(|dir| flag_path(&PathBuf::from(dir).join(identifier)).exists())
        .unwrap_or(false)
}

/// Os argumentos do WebView2: os de sempre e, sem aceleração, o `--disable-gpu`.
pub fn browser_args(gpu_disabled: bool) -> String {
    let mut args = String::from(
        "--enable-usermedia-screen-capturing --auto-select-desktop-capture-source=Entire screen",
    );
    if gpu_disabled {
        args.push_str(" --disable-gpu");
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sem_aceleracao_o_webview_ganha_o_disable_gpu() {
        assert!(!browser_args(false).contains("--disable-gpu"));
        assert!(browser_args(true).ends_with(" --disable-gpu"));
    }

    #[test]
    fn o_arquivo_fica_na_pasta_de_configuracao() {
        assert_eq!(
            flag_path(Path::new("C:/app")),
            Path::new("C:/app").join(FILE)
        );
    }
}
