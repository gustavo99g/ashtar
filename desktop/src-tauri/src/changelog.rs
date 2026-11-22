//! "O que há de novo" (decisão 9 de `docs/plans/v0.2.0-base-de-entrega.md`).
//!
//! O `CHANGELOG.md` da raiz do repositório é embutido no binário na
//! compilação; [`since`] devolve as seções de todas as versões depois da
//! última vista, para quem pulou alguma (v0.4), ou só a da versão instalada. O formato é o mesmo que o `release.yml` lê com `awk`: um título
//! `## <versão>` por seção, e a seção vai até o próximo `## `.

/// O arquivo inteiro, gravado no executável.
const CHANGELOG: &str = include_str!("../../../CHANGELOG.md");

/// As seções das versões depois de `last_seen` até `current` (inclusive), da
/// mais nova para a mais velha, cada uma com a sua versão. Sem `last_seen`
/// (primeira instalação), ou com uma versão vista que não é anterior à atual,
/// só a de `current`. Versão sem seção (ou com seção vazia) é pulada.
pub fn since(last_seen: Option<&str>, current: &str) -> Vec<(String, String)> {
    sections_since(CHANGELOG, last_seen, current)
}

fn sections_since(
    changelog: &str,
    last_seen: Option<&str>,
    current: &str,
) -> Vec<(String, String)> {
    let only_current = || {
        section(changelog, current)
            .map(|notes| vec![(current.to_owned(), notes)])
            .unwrap_or_default()
    };
    let (Some(seen), Some(top)) = (last_seen.and_then(parse_version), parse_version(current))
    else {
        return only_current();
    };
    if seen >= top {
        return only_current();
    }

    let mut versions: Vec<((u64, u64, u64), &str)> = changelog
        .lines()
        .filter_map(heading_version)
        .filter_map(|version| parse_version(version).map(|parsed| (parsed, version)))
        .filter(|(parsed, _)| *parsed > seen && *parsed <= top)
        .collect();
    versions.sort_by_key(|(parsed, _)| std::cmp::Reverse(*parsed));
    versions.dedup_by(|a, b| a.0 == b.0);
    versions
        .into_iter()
        .filter_map(|(_, version)| {
            section(changelog, version).map(|notes| (version.to_owned(), notes))
        })
        .collect()
}

/// `0.4.10` como `(0, 4, 10)`, para comparar número a número (e não como
/// texto, em que `0.4.10` viria antes de `0.4.2`). `None` se não é uma versão.
fn parse_version(version: &str) -> Option<(u64, u64, u64)> {
    let mut parts = version.split('.').map(|part| part.parse::<u64>().ok());
    let parsed = (parts.next()??, parts.next()??, parts.next()??);
    parts.next().is_none().then_some(parsed)
}

/// A seção de `version` em `changelog`, sem o título e sem linhas em branco
/// nas pontas. `None` se a seção não existe ou está vazia
fn section(changelog: &str, version: &str) -> Option<String> {
    let mut lines = changelog
        .lines()
        .skip_while(|line| heading_version(line) != Some(version));

    lines.next()?; // o título da seção

    let body: Vec<&str> = lines
        .take_while(|line| heading_version(line).is_none())
        .collect();
    let body = body.join("\n").trim().to_owned();

    (!body.is_empty()).then_some(body)
}

/// A versão de um título `## 0.2.0` (o que vem depois, como uma data, é
/// ignorado). `None` se a linha não é um título de seção.
fn heading_version(line: &str) -> Option<&str> {
    let rest = line.strip_prefix("## ")?;
    Some(rest.split_whitespace().next().unwrap_or(""))
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXEMPLO: &str = "\
# O que há de novo no Ashtar

## 0.2.1 — 2026-10-20

- Corrige o eco.

## 0.2.0

- Atualização automática.
- Novo nome.

## 0.1.0

- Primeira versão.
";

    #[test]
    fn pega_so_a_secao_pedida() {
        assert_eq!(
            section(EXEMPLO, "0.2.0").as_deref(),
            Some("- Atualização automática.\n- Novo nome.")
        );
    }

    #[test]
    fn ignora_o_que_vem_depois_da_versao_no_titulo() {
        assert_eq!(
            section(EXEMPLO, "0.2.1").as_deref(),
            Some("- Corrige o eco.")
        );
    }

    #[test]
    fn a_ultima_secao_vai_ate_o_fim() {
        assert_eq!(
            section(EXEMPLO, "0.1.0").as_deref(),
            Some("- Primeira versão.")
        );
    }

    #[test]
    fn versao_ausente_ou_secao_vazia_e_none() {
        assert_eq!(section(EXEMPLO, "9.9.9"), None);
        assert_eq!(section("## 0.3.0\n\n## 0.2.0\n- x", "0.3.0"), None);
    }

    const PULADAS: &str = "\
# O que há de novo no Ashtar

## 0.4.10

- Dez.

## 0.4.3

- Três.

## 0.4.2

## 0.4.1

- Um.

## 0.4.0

- Zero.

## 0.3.21

- Ligações.
";

    fn versoes(secoes: &[(String, String)]) -> Vec<&str> {
        secoes.iter().map(|(version, _)| version.as_str()).collect()
    }

    #[test]
    fn junta_as_versoes_puladas_da_mais_nova_para_a_mais_velha() {
        let secoes = sections_since(PULADAS, Some("0.4.0"), "0.4.3");
        // A 0.4.2 não tem seção: fica de fora, sem erro.
        assert_eq!(versoes(&secoes), ["0.4.3", "0.4.1"]);
        assert_eq!(secoes[0].1, "- Três.");
    }

    #[test]
    fn sem_versao_vista_so_a_atual() {
        assert_eq!(versoes(&sections_since(PULADAS, None, "0.4.3")), ["0.4.3"]);
    }

    #[test]
    fn versao_vista_igual_ou_mais_nova_so_a_atual() {
        assert_eq!(
            versoes(&sections_since(PULADAS, Some("0.4.3"), "0.4.3")),
            ["0.4.3"]
        );
        assert_eq!(
            versoes(&sections_since(PULADAS, Some("0.5.0"), "0.4.3")),
            ["0.4.3"]
        );
        assert_eq!(
            versoes(&sections_since(PULADAS, Some("lixo"), "0.4.3")),
            ["0.4.3"]
        );
    }

    #[test]
    fn versao_vista_que_nao_esta_no_arquivo() {
        // A 0.3.5 saiu do CHANGELOG (ou nunca entrou): conta pelo número.
        assert_eq!(
            versoes(&sections_since(PULADAS, Some("0.3.5"), "0.4.1")),
            ["0.4.1", "0.4.0", "0.3.21"]
        );
    }

    #[test]
    fn a_0_4_10_vem_depois_da_0_4_3_e_nao_se_confunde_com_a_0_4_1() {
        assert_eq!(
            versoes(&sections_since(PULADAS, Some("0.4.1"), "0.4.10")),
            ["0.4.10", "0.4.3"]
        );
        assert_eq!(
            versoes(&sections_since(PULADAS, Some("0.4.0"), "0.4.1")),
            ["0.4.1"]
        );
    }

    #[test]
    fn le_a_versao_como_numeros() {
        assert_eq!(parse_version("0.4.10"), Some((0, 4, 10)));
        assert_eq!(parse_version("0.4"), None);
        assert_eq!(parse_version("0.4.1.2"), None);
        assert_eq!(parse_version("v0.4.1"), None);
    }

    #[test]
    fn prefixo_de_versao_nao_confunde() {
        // "0.2.1" não pode casar com "0.2.10".
        assert_eq!(section("## 0.2.10\n- dez", "0.2.1"), None);
    }
}
