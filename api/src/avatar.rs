//! Cor e letra do avatar, para a página do convite.
//!
//! O app calcula o mesmo em TypeScript. A cor sai do nick, que não muda, então a
//! bolinha de cada um é sempre a mesma, até antes de a conta existir (a tela do
//! nick já mostra a cor enquanto a pessoa digita). As duas implementações têm os
//! mesmos casos de teste: se uma mudar, a outra muda junto.

/// A paleta, nesta ordem. O índice é o hash do nick módulo 8.
pub const PALETTE: [&str; 8] = [
    "#a16207", "#4f46e5", "#15803d", "#be185d", "#0e7490", "#c2410c", "#7c3aed", "#2563eb",
];

/// FNV-1a de 32 bits sobre os bytes UTF-8 do nick, com só as letras ASCII em
/// minúsculas, como o `COLLATE NOCASE` do banco: "Kid" e "KID" são o mesmo nick
/// e têm a mesma cor.
pub fn nick_hash(nick: &str) -> u32 {
    nick.bytes().fold(0x811c_9dc5, |hash, byte| {
        (hash ^ u32::from(byte.to_ascii_lowercase())).wrapping_mul(0x0100_0193)
    })
}

/// A cor do avatar de quem tem esse nick.
pub fn color(nick: &str) -> &'static str {
    PALETTE[(nick_hash(nick) % 8) as usize]
}

/// A letra do avatar: a primeira letra (ou número) do nome que aparece (o nome visível ou, sem
/// ele, o nick), em maiúscula. Pula o que não é letra nem número (`_`, `.`, espaço); só se o nome
/// não tiver nenhum, usa o primeiro caractere, e `?` se estiver vazio. É a mesma regra do
/// `avatarInitial` do app.
pub fn letter(shown_name: &str) -> String {
    shown_name
        .chars()
        .find(|c| c.is_alphanumeric())
        .or_else(|| shown_name.chars().next())
        .map_or_else(|| "?".to_owned(), |c| c.to_uppercase().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_de_referencia() {
        assert_eq!(nick_hash("kid"), 2_096_616_551);
        assert_eq!(nick_hash("carla"), 2_214_914_850);
    }

    /// Os mesmos casos do teste do app (Vitest).
    #[test]
    fn cor_de_cada_nick() {
        let cases = [
            ("kid", 7),
            ("Kid", 7),
            ("KID", 7),
            ("juliana", 7),
            ("marcao", 4),
            ("rafa.gomes", 6),
            ("thiago", 1),
            ("luana", 4),
            ("pedro.h", 7),
            ("carla", 2),
            ("João", 1),
            ("joão", 1),
            ("JOÃO", 1),
            ("ab", 2),
            ("zé", 1),
            ("a b", 2),
            ("x_y-z.w", 7),
        ];
        for (nick, index) in cases {
            assert_eq!(color(nick), PALETTE[index], "{nick}");
        }
        assert_eq!(color("kid"), "#2563eb");
        assert_eq!(color("marcao"), "#0e7490");
        assert_eq!(color("rafa.gomes"), "#7c3aed");
        assert_eq!(color("thiago"), "#4f46e5");
        assert_eq!(color("carla"), "#15803d");
    }

    #[test]
    fn letra_e_a_primeira_em_maiuscula() {
        assert_eq!(letter("juju"), "J");
        assert_eq!(letter("élio"), "É");
        assert_eq!(letter("2pac"), "2");
        // Pula o que não é letra nem número, como o `avatarInitial` do app.
        assert_eq!(letter("_ana"), "A");
        assert_eq!(letter(".x"), "X");
        assert_eq!(letter("✨ juju"), "J");
        assert_eq!(letter("___"), "_");
        assert_eq!(letter(""), "?");
    }
}
