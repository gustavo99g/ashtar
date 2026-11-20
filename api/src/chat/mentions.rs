//! Menções (ADR 0022): os `@nick` de uma mensagem, achados pela API no envio.
//!
//! O app não diz quem foi mencionado: ele manda o texto, e a API procura. Assim
//! ninguém menciona quem não lê o canal, e o app antigo, que não sabe de
//! menção, menciona do mesmo jeito.

use sqlx::SqlitePool;

use super::access::{self, Readable};
use crate::error::ApiError;
use crate::identity::User;

/// Quantas pessoas uma mensagem menciona, no máximo. As que passam disso ficam
/// só como texto.
pub const MENTIONS_MAX: usize = 10;

/// Alguém que pode ser mencionado: o id e o nick.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct Candidate {
    pub id: String,
    pub nick: String,
}

/// Os ids de quem `body` menciona, na ordem em que aparecem, sem repetir e até
/// [`MENTIONS_MAX`].
///
/// O `@` vale no começo ou depois de espaço ou pontuação. Não vale colado numa
/// letra, num número ou em `.`, `_`, `-`, `+` (um e-mail), nem dentro de um
/// pedaço com `://` (um link). O nick é comparado sem diferenciar maiúsculas e
/// tem de terminar ali: `@ana` não é a Ana em `@anabela`. Como o nick pode ter
/// espaço e ponto, a busca é pelos nicks que existem, do mais comprido para o
/// mais curto, e não por "a palavra depois do `@`".
pub fn find(body: &str, candidates: &[Candidate]) -> Vec<String> {
    let mut by_length: Vec<(Vec<char>, &str)> = candidates
        .iter()
        .map(|c| (lower(&c.nick), c.id.as_str()))
        .collect();
    by_length.sort_by_key(|(nick, _)| std::cmp::Reverse(nick.len()));

    let chars: Vec<char> = body.chars().collect();
    let mut found: Vec<String> = Vec::new();
    for at in (0..chars.len()).filter(|&i| chars[i] == '@') {
        if found.len() == MENTIONS_MAX {
            break;
        }
        if !starts_mention(&chars, at) {
            continue;
        }
        let rest = &chars[at + 1..];
        let hit = by_length.iter().find(|(nick, _)| {
            rest.len() >= nick.len()
                && lower_chars(&rest[..nick.len()]) == *nick
                && rest
                    .get(nick.len())
                    .is_none_or(|next| !continues_nick(*next))
        });
        if let Some((_, id)) = hit
            && !found.iter().any(|known| known == id)
        {
            found.push((*id).to_owned());
        }
    }
    found
}

fn lower(text: &str) -> Vec<char> {
    text.to_lowercase().chars().collect()
}

fn lower_chars(chars: &[char]) -> Vec<char> {
    chars.iter().flat_map(|c| c.to_lowercase()).collect()
}

/// Se depois do nick vem algo que ainda seria nick: aí é outro nome.
fn continues_nick(next: char) -> bool {
    next.is_alphanumeric() || matches!(next, '_' | '-')
}

/// Se o `@` da posição `at` pode começar uma menção.
fn starts_mention(chars: &[char], at: usize) -> bool {
    if let Some(before) = at.checked_sub(1).map(|i| chars[i])
        && (before.is_alphanumeric() || matches!(before, '.' | '_' | '-' | '+' | '@'))
    {
        return false;
    }
    // O pedaço entre espaços em que o `@` está: com `://`, é um link.
    let start = chars[..at]
        .iter()
        .rposition(|c| c.is_whitespace())
        .map_or(0, |i| i + 1);
    let end = chars[at..]
        .iter()
        .position(|c| c.is_whitespace())
        .map_or(chars.len(), |i| at + i);
    let token: String = chars[start..end].iter().collect();
    !token.contains("://")
}

/// Quem `author` menciona com `body` em `channel`: só quem está ativo, lê o
/// canal e não é ele mesmo. Num canal de texto, todo membro ativo (num restrito,
/// só quem o acessa, ADR 0028); numa conversa privada, a outra pessoa. O `@nick` de um terceiro numa conversa
/// não menciona ninguém.
pub async fn resolve(
    db: &SqlitePool,
    channel: &Readable,
    author: &User,
    body: &str,
) -> Result<Vec<String>, ApiError> {
    if !body.contains('@') {
        return Ok(Vec::new());
    }
    let candidates: Vec<Candidate> = match channel {
        Readable::Text(text) => {
            let everyone: Vec<Candidate> =
                sqlx::query_as("SELECT id, nick FROM users WHERE removed_at IS NULL AND id <> ?")
                    .bind(&author.id)
                    .fetch_all(db)
                    .await?;
            match access::allowed(db, &text.id).await? {
                None => everyone,
                Some(allowed) => everyone
                    .into_iter()
                    .filter(|c| allowed.contains(&c.id))
                    .collect(),
            }
        }
        Readable::Dm(dm) => {
            sqlx::query_as("SELECT id, nick FROM users WHERE removed_at IS NULL AND id = ?")
                .bind(dm.other(&author.id))
                .fetch_all(db)
                .await?
        }
    };
    Ok(find(body, &candidates))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn people() -> Vec<Candidate> {
        [
            ("a", "Ana"),
            ("b", "Ana Paula"),
            ("c", "zé.silva"),
            ("d", "Bia"),
        ]
        .into_iter()
        .map(|(id, nick)| Candidate {
            id: id.into(),
            nick: nick.into(),
        })
        .collect()
    }

    fn found(body: &str) -> Vec<String> {
        find(body, &people())
    }

    #[test]
    fn acha_no_comeco_depois_de_espaco_e_de_pontuacao() {
        assert_eq!(found("@Ana oi"), ["a"]);
        assert_eq!(found("oi @bia"), ["d"]);
        assert_eq!(found("oi (@Bia), tudo bem?"), ["d"]);
        assert_eq!(found("linha\n@BIA"), ["d"]);
        assert_eq!(found("valeu, @ana!"), ["a"]);
    }

    #[test]
    fn o_nick_mais_comprido_ganha() {
        assert_eq!(found("@Ana Paula chegou"), ["b"]);
        assert_eq!(
            found("@ana pauleira"),
            ["a"],
            "Ana, seguida de outra palavra"
        );
        assert_eq!(found("@zé.silva."), ["c"], "o ponto final não atrapalha");
    }

    #[test]
    fn nao_acha_dentro_de_palavra_email_ou_link() {
        assert_eq!(found("fulano@ana.com"), Vec::<String>::new());
        assert_eq!(found("fulano.@ana"), Vec::<String>::new());
        assert_eq!(found("https://site.com/@ana"), Vec::<String>::new());
        assert_eq!(
            found("veja https://x.com/?q=1&u=@bia agora"),
            Vec::<String>::new()
        );
        assert_eq!(found("@anabela"), Vec::<String>::new());
        assert_eq!(found("@ana_2"), Vec::<String>::new());
        assert_eq!(found("@ ana"), Vec::<String>::new());
        assert_eq!(found("@todos"), Vec::<String>::new());
    }

    #[test]
    fn nao_repete_e_segue_a_ordem_do_texto() {
        assert_eq!(found("@bia @ana @Bia"), ["d", "a"]);
    }

    #[test]
    fn para_em_dez() {
        let many: Vec<Candidate> = (0..12)
            .map(|n| Candidate {
                id: format!("u{n}"),
                nick: format!("nick{n:02}"),
            })
            .collect();
        let body: String = many.iter().map(|c| format!("@{} ", c.nick)).collect();
        let found = find(&body, &many);
        assert_eq!(found.len(), MENTIONS_MAX);
        assert_eq!(found[0], "u0");
        assert_eq!(found[9], "u9");
    }
}
