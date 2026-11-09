//! Ajudas pequenas para o código da crate `windows`: erros e textos.

use crate::error::AppError;

/// Transforma o erro de uma chamada do Windows num `AppError::VideoCapture` com o nome da chamada e
/// o HRESULT, que é o que o log precisa para dizer o que falhou:
/// `.map_err(hr("CreateForWindow"))`.
pub fn hr(what: &'static str) -> impl FnOnce(windows::core::Error) -> AppError {
    move |error| {
        AppError::VideoCapture(format!(
            "{what}: {} ({:#010x})",
            error.message(),
            error.code().0
        ))
    }
}

/// Textos do Windows vêm em arrays de tamanho fixo e terminam no primeiro zero.
pub fn wide(text: &[u16]) -> String {
    let end = text.iter().position(|&c| c == 0).unwrap_or(text.len());
    String::from_utf16_lossy(&text[..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn texto_para_no_primeiro_zero() {
        let text: Vec<u16> = "AMD\0lixo".encode_utf16().collect();
        assert_eq!(wide(&text), "AMD");
        let text: Vec<u16> = "sem zero".encode_utf16().collect();
        assert_eq!(wide(&text), "sem zero");
    }

    #[test]
    fn erro_leva_o_nome_da_chamada_e_o_codigo() {
        let error = windows::core::Error::from_hresult(windows::Win32::Foundation::E_ACCESSDENIED);
        let AppError::VideoCapture(message) = hr("CreateForWindow")(error) else {
            panic!("esperava VideoCapture");
        };
        assert!(message.starts_with("CreateForWindow: "), "{message}");
        assert!(message.ends_with("(0x80070005)"), "{message}");
    }
}
