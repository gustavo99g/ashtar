//! A leitura da página e do texto: os links de uma mensagem e as tags `og:`/`twitter:` de uma
//! página. Sem biblioteca de HTML: só as tags `<meta>` e o `<title>` do começo da página.

use reqwest::Url;

/// Quantos links de uma mensagem ganham prévia.
pub const MAX_LINKS: usize = 3;

/// Os links da mensagem que ganham prévia, na ordem, sem repetir, até [`MAX_LINKS`]. Um link
/// dentro de `<...>` não ganha (decisão 22), nem o que está em código.
pub fn links(body: &str) -> Vec<Url> {
    let mut found: Vec<Url> = Vec::new();
    let mut in_block = false;
    for line in body.lines() {
        if line.trim_start().starts_with("```") {
            in_block = !in_block;
            continue;
        }
        if in_block {
            continue;
        }
        // O código de uma linha (`...`) sai: o que sobra fica nas partes pares.
        for (index, part) in line.split('`').enumerate() {
            if index % 2 == 1 {
                continue;
            }
            for word in part.split(|c: char| c.is_whitespace()) {
                let Some(start) = word.find("http://").or_else(|| word.find("https://")) else {
                    continue;
                };
                if word[..start].ends_with('<') {
                    continue;
                }
                let raw = word[start..]
                    .split(['<', '>'])
                    .next()
                    .unwrap_or("")
                    .trim_end_matches(|c: char| ".,;:!?)]}'\"|*_~".contains(c));
                let Ok(url) = Url::parse(raw) else { continue };
                if url.host_str().is_none() || found.contains(&url) {
                    continue;
                }
                found.push(url);
                if found.len() == MAX_LINKS {
                    return found;
                }
            }
        }
    }
    found
}

/// O que a página diz de si.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct PageMeta {
    pub site: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<Url>,
}

/// Os atributos de uma tag, a partir do nome dela: `name="x" content='y' z=w`.
fn attributes(tag: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut rest = tag;
    loop {
        rest = rest.trim_start_matches(|c: char| c.is_whitespace() || c == '/');
        let Some(eq) = rest.find('=') else { break };
        let name = rest[..eq].trim().to_ascii_lowercase();
        if name.contains(char::is_whitespace) {
            // Um atributo sem valor antes: pula o nome dele.
            let skip = name.find(char::is_whitespace).unwrap_or(name.len());
            rest = &rest[skip..];
            continue;
        }
        let after = rest[eq + 1..].trim_start();
        let (value, next) = match after.chars().next() {
            Some(quote @ ('"' | '\'')) => {
                let inner = &after[1..];
                match inner.find(quote) {
                    Some(end) => (&inner[..end], &inner[end + 1..]),
                    None => (inner, ""),
                }
            }
            _ => {
                let end = after
                    .find(|c: char| c.is_whitespace() || c == '>')
                    .unwrap_or(after.len());
                (&after[..end], &after[end..])
            }
        };
        out.push((name, decode_entities(value)));
        rest = next;
    }
    out
}

/// As entidades mais comuns do HTML: `&amp;`, `&quot;`, `&#39;`, `&#x27;`...
pub fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        rest = &rest[amp..];
        let Some(semi) = rest[..rest.len().min(12)].find(';') else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..semi];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            _ => entity
                .strip_prefix("#x")
                .or_else(|| entity.strip_prefix("#X"))
                .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                .or_else(|| entity.strip_prefix('#').and_then(|d| d.parse().ok()))
                .and_then(char::from_u32),
        };
        match decoded {
            Some(c) => {
                out.push(c);
                rest = &rest[semi + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// O texto numa linha só, sem espaços sobrando, até `max` caracteres (com "…").
fn tidy(text: &str, max: usize) -> Option<String> {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.is_empty() {
        return None;
    }
    if line.chars().count() <= max {
        return Some(line);
    }
    let mut cut: String = line.chars().take(max - 1).collect();
    cut.push('…');
    Some(cut)
}

/// Lê as tags de `html`, da página `page` (para os endereços relativos da imagem).
pub fn parse(html: &str, page: &Url) -> PageMeta {
    let lower = html.to_ascii_lowercase();
    let mut values: Vec<(String, String)> = Vec::new();
    let mut from = 0;
    while let Some(at) = lower[from..].find("<meta") {
        let start = from + at + 5;
        let end = lower[start..].find('>').map_or(lower.len(), |e| start + e);
        let attrs = attributes(&html[start..end]);
        let key = attrs
            .iter()
            .find(|(n, _)| n == "property" || n == "name")
            .map(|(_, v)| v.to_ascii_lowercase());
        let content = attrs.iter().find(|(n, _)| n == "content").map(|(_, v)| v);
        if let (Some(key), Some(content)) = (key, content) {
            values.push((key, content.clone()));
        }
        from = end;
    }
    let get = |keys: &[&str]| {
        keys.iter().find_map(|key| {
            values
                .iter()
                .find(|(k, v)| k == key && !v.trim().is_empty())
                .map(|(_, v)| v.clone())
        })
    };
    let title_tag = lower.find("<title").and_then(|at| {
        let open = at + lower[at..].find('>')? + 1;
        let close = open + lower[open..].find("</title")?;
        Some(decode_entities(&html[open..close]))
    });
    let site = get(&["og:site_name"]).or_else(|| {
        page.host_str()
            .map(|host| host.trim_start_matches("www.").to_owned())
    });
    PageMeta {
        site: site.and_then(|s| tidy(&s, 100)),
        title: get(&["og:title", "twitter:title"])
            .or(title_tag)
            .and_then(|t| tidy(&t, 200)),
        description: get(&["og:description", "twitter:description", "description"])
            .and_then(|d| tidy(&d, 300)),
        image: get(&[
            "og:image:secure_url",
            "og:image:url",
            "og:image",
            "twitter:image",
            "twitter:image:src",
        ])
        .and_then(|src| page.join(src.trim()).ok())
        .filter(|url| matches!(url.scheme(), "http" | "https")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strs(urls: Vec<Url>) -> Vec<String> {
        urls.into_iter().map(String::from).collect()
    }

    #[test]
    fn os_links_da_mensagem() {
        assert_eq!(
            strs(links(
                "olha https://youtu.be/abc, e http://exemplo.com/a?b=1. (https://x.org/y)"
            )),
            [
                "https://youtu.be/abc",
                "http://exemplo.com/a?b=1",
                "https://x.org/y"
            ]
        );
        // Entre < >, em código, repetidos ou além do terceiro: não.
        assert_eq!(
            strs(links(
                "<https://a.com> `https://b.com` https://c.com https://c.com\n```\nhttps://d.com\n```\nhttps://e.com https://f.com https://g.com"
            )),
            ["https://c.com/", "https://e.com/", "https://f.com/"]
        );
        assert!(links("ftp://a.com e https:// sozinho").is_empty());
        assert_eq!(strs(links("||https://s.com||")), ["https://s.com/"]);
    }

    #[test]
    fn le_as_tags_og_e_cai_no_title() {
        let page = Url::parse("https://www.exemplo.com/post/1").unwrap();
        let html = r#"<html><head>
            <title>Título &amp; tal</title>
            <meta property="og:title" content="O &quot;post&quot;">
            <meta name=description content='Uma   descrição
              em duas linhas'>
            <meta property="og:image" content="/capa.png" />
            </head></html>"#;
        assert_eq!(
            parse(html, &page),
            PageMeta {
                site: Some("exemplo.com".into()),
                title: Some("O \"post\"".into()),
                description: Some("Uma descrição em duas linhas".into()),
                image: Some(Url::parse("https://www.exemplo.com/capa.png").unwrap()),
            }
        );
        let bare = parse("<title>Só o título</title>", &page);
        assert_eq!(bare.title.as_deref(), Some("Só o título"));
        assert_eq!(bare.image, None);
        let js = parse(
            r#"<meta property="og:image" content="javascript:alert(1)">"#,
            &page,
        );
        assert_eq!(js.image, None);
    }

    #[test]
    fn as_entidades() {
        assert_eq!(
            decode_entities("a &amp; b &#39;c&#x27; &nada; &"),
            "a & b 'c' &nada; &"
        );
    }
}
