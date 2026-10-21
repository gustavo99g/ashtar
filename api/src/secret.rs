//! Segredos: geração aleatória e hash.
//!
//! O banco nunca guarda um segredo em claro: código de convite, token de
//! sessão e chave do dispositivo entram só como SHA-256. Os três têm entropia
//! alta (não são senhas escolhidas por gente), então um hash rápido basta:
//! bcrypt e argon2 só fazem diferença contra quem tenta adivinhar senhas fracas.

use sha2::{Digest, Sha256};

/// Alfabeto Crockford: sem I, L, O e U, para não confundir na hora de digitar.
const INVITE_ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Tamanho do código de convite, sem os hífens. 12 caracteres de 32 = 60 bits.
const INVITE_LEN: usize = 12;

/// SHA-256 em hexadecimal.
pub fn hash(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

/// Token de sessão: 32 bytes aleatórios em hexadecimal (64 caracteres).
pub fn new_session_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("o sistema deveria fornecer bytes aleatórios");
    hex::encode(bytes)
}

/// Código de convite novo, no formato `XXXX-XXXX-XXXX`.
pub fn new_invite_code() -> String {
    let mut bytes = [0u8; INVITE_LEN];
    getrandom::fill(&mut bytes).expect("o sistema deveria fornecer bytes aleatórios");

    // 256 é múltiplo de 32: o resto da divisão não favorece nenhuma letra.
    let chars: Vec<char> = bytes
        .iter()
        .map(|b| INVITE_ALPHABET[usize::from(*b) % 32] as char)
        .collect();
    chars
        .chunks(4)
        .map(|chunk| chunk.iter().collect::<String>())
        .collect::<Vec<_>>()
        .join("-")
}

/// Normaliza o que a pessoa digitou: tira hífens e espaços, passa para
/// maiúsculas e troca as letras ambíguas (`O` vira `0`, `I` e `L` viram `1`).
/// `None` se sobrar algo fora do alfabeto ou o tamanho estiver errado.
pub fn normalize_invite_code(input: &str) -> Option<String> {
    let code: String = input
        .chars()
        .filter(|c| *c != '-' && !c.is_whitespace())
        .map(|c| match c.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            other => other,
        })
        .collect();

    let valid = code.len() == INVITE_LEN && code.bytes().all(|b| INVITE_ALPHABET.contains(&b));
    valid.then_some(code)
}

/// O código no formato `XXXX-XXXX-XXXX`, do jeito que foi gerado, a partir do que
/// a pessoa digitou. `None` se não for um código. A página do convite usa esse
/// formato nos links, mesmo que o endereço tenha vindo em minúsculas.
pub fn display_invite_code(input: &str) -> Option<String> {
    let code = normalize_invite_code(input)?;
    Some(format!("{}-{}-{}", &code[..4], &code[4..8], &code[8..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codigo_novo_tem_o_formato_certo() {
        let code = new_invite_code();
        assert_eq!(code.len(), 14);
        assert_eq!(code.matches('-').count(), 2);
        assert!(normalize_invite_code(&code).is_some());
    }

    #[test]
    fn normaliza_o_que_a_pessoa_digitou() {
        assert_eq!(
            normalize_invite_code(" abcd-efgh-jk0o ").as_deref(),
            Some("ABCDEFGHJK00")
        );
        assert_eq!(
            normalize_invite_code("1il1-2222-3333").as_deref(),
            Some("111122223333")
        );
    }

    #[test]
    fn recusa_codigo_invalido() {
        assert_eq!(normalize_invite_code("ABCD-EFGH"), None);
        assert_eq!(normalize_invite_code("ABCD-EFGH-JKU0"), None);
    }

    #[test]
    fn tokens_sao_diferentes() {
        assert_ne!(new_session_token(), new_session_token());
        assert_eq!(new_session_token().len(), 64);
    }

    #[test]
    fn mostra_o_codigo_com_hifens() {
        assert_eq!(
            display_invite_code("abcd efgh jk0o").as_deref(),
            Some("ABCD-EFGH-JK00")
        );
        assert_eq!(display_invite_code("ABCD-EFGH"), None);
    }
}
