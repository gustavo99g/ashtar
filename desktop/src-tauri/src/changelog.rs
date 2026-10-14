//! "O que há de novo" (decisão 9 de `docs/plans/v0.2.0-base-de-entrega.md`).
//!
//! O `CHANGELOG.md` da raiz do repositório é embutido no binário na
//! compilação; [`for_version`] devolve a seção de uma versão. O formato é o
//! mesmo que o `release.yml` lê com `awk`: um título `## <versão>` por seção,
//! e a seção vai até o próximo `## `.

/// O arquivo inteiro, gravado no executável.
const CHANGELOG: &str = include_str!("../../../CHANGELOG.md");

/// A seção da versão no `CHANGELOG.md` embutido, sem o título.
pub fn for_version(version: &str) -> Option<String> {
    section(CHANGELOG, version)
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

    #[test]
    fn prefixo_de_versao_nao_confunde() {
        // "0.2.1" não pode casar com "0.2.10".
        assert_eq!(section("## 0.2.10\n- dez", "0.2.1"), None);
    }
}
