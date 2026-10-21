//! As páginas que o navegador abre: o link do convite (`/invite/CÓDIGO`), o da
//! recuperação (`/recovery/CÓDIGO`), o ícone da prévia (`/invite.png`) e o
//! "Baixar para Windows" (`/download`).
//!
//! Ficam fora do `/api` e da `ClientPolicy`, como o `/health`: o navegador e o
//! robô que monta a prévia no chat não mandam a versão do app. O HTML vem de
//! `assets/`, embutido no binário. Todo texto que entra nele passa por [`escape`],
//! e código errado conta no limite de tentativas, como no `redeem`.

use std::fmt::Display;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::response::{Html, IntoResponse, Redirect, Response};
use chrono::{DateTime, Datelike, Local, TimeZone};

use crate::AppState;
use crate::avatar;
use crate::db::now;
use crate::error::ApiError;
use crate::identity::invites::{self, InviteKind, InvitePreview};
use crate::secret;

/// A casca da página: `<head>` com as tags da prévia, o fundo e o script.
const PAGE: &str = include_str!("../../assets/page.html");
/// O cartão de cada caso, que entra no lugar do `<!-- corpo -->` da casca.
const INVITE: &str = include_str!("../../assets/invite.html");
const RECOVERY: &str = include_str!("../../assets/recovery.html");
const INVALID: &str = include_str!("../../assets/expired.html");
/// O ícone de 512 × 512: a prévia do chat não mostra SVG.
const ICON: &[u8] = include_bytes!("../../assets/invite.png");

const MONTHS: [&str; 12] = [
    "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez",
];

/// `GET /invite/{código}`.
pub async fn invite(State(state): State<AppState>, Path(code): Path<String>) -> Response {
    invite_page(&state, &code, InviteKind::New).await
}

/// `GET /recovery/{código}`.
pub async fn recovery(State(state): State<AppState>, Path(code): Path<String>) -> Response {
    invite_page(&state, &code, InviteKind::Recovery).await
}

/// `GET /invite.png`.
pub async fn icon() -> impl IntoResponse {
    (
        [
            (CONTENT_TYPE, "image/png"),
            (CACHE_CONTROL, "public, max-age=86400"),
        ],
        ICON,
    )
}

/// `GET /download`: manda para o instalador da última versão estável.
pub async fn download(State(state): State<AppState>) -> Redirect {
    Redirect::temporary(&state.download.url().await)
}

/// Lê o convite e monta a página. O caminho (`/convite` ou `/recuperar`) só
/// escolhe o título da aba quando o convite não vale: valendo, a página segue o
/// tipo de verdade do convite.
async fn invite_page(state: &AppState, code: &str, path_kind: InviteKind) -> Response {
    if state.limiter.check().is_err() {
        let html = blocked_page(&state.public_url, path_kind);
        return html_response(StatusCode::TOO_MANY_REQUESTS, html);
    }
    let now = now();
    match invites::preview(&state.db, code, now).await {
        Ok(preview) => {
            // O `preview` já validou o código, então ele tem o formato certo.
            let code = secret::display_invite_code(code).unwrap_or_default();
            let link = state.invite_link(preview.kind, &code);
            let html = valid_page(&state.public_url, &preview, &code, &link, now, &Local);
            html_response(StatusCode::OK, html)
        }
        Err(ApiError::InvalidInvite) => {
            state.limiter.record_failure();
            // 200, para o chat ainda montar o cartão com "Esse convite não vale mais".
            html_response(StatusCode::OK, invalid_page(&state.public_url, path_kind))
        }
        Err(error) => error.into_response(),
    }
}

fn html_response(status: StatusCode, html: String) -> Response {
    // A página muda quando o convite vence: nada de guardar cópia.
    (status, [(CACHE_CONTROL, "no-store")], Html(html)).into_response()
}

/// A página de um convite que vale.
pub fn valid_page<Tz>(
    public_url: &str,
    preview: &InvitePreview,
    code: &str,
    link: &str,
    now: i64,
    tz: &Tz,
) -> String
where
    Tz: TimeZone,
    Tz::Offset: Display,
{
    let person = &preview.person;
    let name = person.shown_name();
    let until = valid_until(preview.expires_at, now, tz);
    let (path, card) = match preview.kind {
        InviteKind::New => ("invite", INVITE),
        InviteKind::Recovery => ("recovery", RECOVERY),
    };
    let app_link = format!("ashtar://{path}/{code}");
    let body = fill(
        card,
        &[
            ("cor", avatar::color(&person.nick)),
            ("letra", &avatar::letter(name)),
            ("nome", name),
            ("validade", &until),
            ("link_app", &app_link),
            ("link", link),
        ],
    );
    match preview.kind {
        InviteKind::New => shell(
            public_url,
            "Convite para o Ashtar",
            &format!("{name} te convidou para o Ashtar"),
            &format!("{until}. Abra o link para entrar no app de voz do grupo."),
            link,
            &body,
        ),
        InviteKind::Recovery => shell(
            public_url,
            "Trocar de computador no Ashtar",
            "Trocar de computador no Ashtar",
            &format!("Conta de {name}. {until} · uso único."),
            link,
            &body,
        ),
    }
}

/// A página de um convite que não vale: não diz por quê.
pub fn invalid_page(public_url: &str, path_kind: InviteKind) -> String {
    let body = fill(
        INVALID,
        &[
            ("titulo", "Esse convite não vale mais"),
            (
                "texto",
                "Ele pode ter expirado, sido cancelado ou já ter sido usado. \
                 Peça um link novo ao dono do grupo.",
            ),
            ("rodape", "Quando chegar o link novo, é só clicar nele."),
        ],
    );
    shell(
        public_url,
        tab_title(path_kind),
        "Esse convite não vale mais",
        "Peça um link novo ao dono do grupo.",
        public_url,
        &body,
    )
}

/// A página de quando o limite de tentativas travou os convites.
pub fn blocked_page(public_url: &str, path_kind: InviteKind) -> String {
    let body = fill(
        INVALID,
        &[
            ("titulo", "Muitas tentativas"),
            ("texto", "Espere alguns minutos e tente de novo."),
            ("rodape", "Depois, é só abrir o link de novo."),
        ],
    );
    shell(
        public_url,
        tab_title(path_kind),
        "Muitas tentativas",
        "Espere alguns minutos e tente de novo.",
        public_url,
        &body,
    )
}

fn tab_title(kind: InviteKind) -> &'static str {
    match kind {
        InviteKind::New => "Convite para o Ashtar",
        InviteKind::Recovery => "Trocar de computador no Ashtar",
    }
}

/// Monta a casca com as tags da prévia e põe o cartão no lugar do `<!-- corpo -->`.
/// O cartão já vem preenchido (e escapado) por [`fill`].
fn shell(
    public_url: &str,
    tab: &str,
    og_title: &str,
    og_description: &str,
    og_url: &str,
    body: &str,
) -> String {
    let image = format!("{public_url}/invite.png");
    fill(
        PAGE,
        &[
            ("aba", tab),
            ("og_titulo", og_title),
            ("og_descricao", og_description),
            ("og_url", og_url),
            ("og_imagem", &image),
        ],
    )
    .replacen("<!-- corpo -->", body, 1)
}

/// "Vale até hoje, 21:35", "Vale até amanhã, 08:00" ou "Vale até 24 out, 12:15",
/// no fuso `tz` (o do computador da API, que é o do grupo).
pub fn valid_until<Tz>(expires_at: i64, now: i64, tz: &Tz) -> String
where
    Tz: TimeZone,
    Tz::Offset: Display,
{
    let local = |seconds: i64| {
        DateTime::from_timestamp(seconds, 0)
            .unwrap_or_default()
            .with_timezone(tz)
    };
    let expires = local(expires_at);
    let today = local(now).date_naive();
    let day = expires.date_naive();
    let when = if day == today {
        "hoje".to_owned()
    } else if today.succ_opt() == Some(day) {
        "amanhã".to_owned()
    } else {
        format!("{} {}", day.day(), MONTHS[day.month0() as usize])
    };
    format!("Vale até {when}, {}", expires.format("%H:%M"))
}

/// Troca cada `{{chave}}` do modelo pelo valor, escapado para HTML. Uma passada
/// só: um valor que contenha `{{...}}` não é trocado de novo. Uma chave sem valor
/// é erro de quem escreveu o modelo, e os testes pegam.
fn fill(template: &str, values: &[(&str, &str)]) -> String {
    let mut html = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        html.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let end = after.find("}}").expect("modelo com {{ sem }}");
        let key = &after[..end];
        let value = values
            .iter()
            .find(|(k, _)| *k == key)
            .map(|(_, v)| *v)
            .unwrap_or_else(|| panic!("o modelo pede {key}, que não veio"));
        html.push_str(&escape(value));
        rest = &after[end + 2..];
    }
    html.push_str(rest);
    html
}

/// Escapa texto para dentro do HTML, inclusive dentro de atributos.
pub fn escape(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(c),
        }
    }
    escaped
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::User;
    use chrono::FixedOffset;

    /// 17/10/2026, 21:00 em Brasília (UTC-3).
    const NOW: i64 = 1_792_281_600;
    const HOUR: i64 = 60 * 60;

    fn brasilia() -> FixedOffset {
        FixedOffset::west_opt(3 * 3600).unwrap()
    }

    fn preview(kind: InviteKind, nick: &str, display_name: Option<&str>) -> InvitePreview {
        InvitePreview {
            kind,
            person: User {
                id: "id".into(),
                nick: nick.into(),
                display_name: display_name.map(str::to_owned),
                is_owner: false,
                created_at: 0,
                removed_at: None,
            },
            expires_at: NOW + 35 * 60,
        }
    }

    #[test]
    fn escapa_o_que_e_html() {
        assert_eq!(
            escape(r#"<b a="1" b='2'>&</b>"#),
            "&lt;b a=&quot;1&quot; b=&#39;2&#39;&gt;&amp;&lt;/b&gt;"
        );
        assert_eq!(escape("juju"), "juju");
    }

    #[test]
    fn preenche_numa_passada_so() {
        let html = fill("<p>{{a}} e {{b}}</p>", &[("a", "{{b}}"), ("b", "<i>")]);
        assert_eq!(html, "<p>{{b}} e &lt;i&gt;</p>");
    }

    #[test]
    fn validade_em_palavras() {
        let tz = brasilia();
        assert_eq!(valid_until(NOW + 35 * 60, NOW, &tz), "Vale até hoje, 21:35");
        // Passou da meia-noite: amanhã.
        assert_eq!(
            valid_until(NOW + 3 * HOUR + 5 * 60, NOW, &tz),
            "Vale até amanhã, 00:05"
        );
        assert_eq!(
            valid_until(NOW + 7 * 24 * HOUR - 9 * HOUR, NOW, &tz),
            "Vale até 24 out, 12:00"
        );
        // O fuso decide a hora: em UTC, o mesmo instante é 00:35.
        assert_eq!(
            valid_until(NOW + 35 * 60, NOW, &FixedOffset::east_opt(0).unwrap()),
            "Vale até hoje, 00:35"
        );
    }

    #[test]
    fn todo_modelo_preenche_sem_sobrar_chave() {
        let tz = brasilia();
        let pages = [
            valid_page(
                "https://a.test",
                &preview(InviteKind::New, "kid", None),
                "AAAA-BBBB-CCCC",
                "https://a.test/invite/AAAA-BBBB-CCCC",
                NOW,
                &tz,
            ),
            valid_page(
                "https://a.test",
                &preview(InviteKind::Recovery, "juliana", Some("juju")),
                "AAAA-BBBB-CCCC",
                "https://a.test/recovery/AAAA-BBBB-CCCC",
                NOW,
                &tz,
            ),
            invalid_page("https://a.test", InviteKind::New),
            blocked_page("https://a.test", InviteKind::Recovery),
        ];
        for html in pages {
            assert!(!html.contains("{{"), "{html}");
            assert!(!html.contains("<!-- corpo -->"), "{html}");
            assert!(html.contains(r#"content="https://a.test/invite.png""#));
        }
    }

    #[test]
    fn convite_mostra_quem_convidou_com_cor_e_letra() {
        let html = valid_page(
            "https://a.test",
            &preview(InviteKind::New, "kid", None),
            "AAAA-BBBB-CCCC",
            "https://a.test/invite/AAAA-BBBB-CCCC",
            NOW,
            &brasilia(),
        );
        assert!(html.contains("<title>Convite para o Ashtar</title>"));
        assert!(
            html.contains(r#"<meta property="og:title" content="kid te convidou para o Ashtar">"#)
        );
        assert!(html.contains(
            r#"content="Vale até hoje, 21:35. Abra o link para entrar no app de voz do grupo.""#
        ));
        assert!(html.contains(r#"style="background: #2563eb""#));
        assert!(html.contains(r#"aria-hidden="true">K</span>"#));
        assert!(html.contains(r#"href="ashtar://invite/AAAA-BBBB-CCCC""#));
        assert!(html.contains(r#"data-link="https://a.test/invite/AAAA-BBBB-CCCC""#));
    }

    #[test]
    fn recuperacao_mostra_a_conta_pelo_nome_visivel() {
        let html = valid_page(
            "https://a.test",
            &preview(InviteKind::Recovery, "juliana", Some("juju")),
            "AAAA-BBBB-CCCC",
            "https://a.test/recovery/AAAA-BBBB-CCCC",
            NOW,
            &brasilia(),
        );
        assert!(html.contains("<title>Trocar de computador no Ashtar</title>"));
        assert!(html.contains(r#"Conta de <span class="conta">juju</span>"#));
        assert!(html.contains("Vale até hoje, 21:35 · uso único"));
        // A cor sai do nick; a letra, do nome que aparece.
        assert!(html.contains(r#"style="background: #2563eb""#));
        assert!(html.contains(r#"aria-hidden="true">J</span>"#));
        assert!(html.contains(r#"href="ashtar://recovery/AAAA-BBBB-CCCC""#));
    }

    #[test]
    fn vencido_nao_tem_botao_nem_nome() {
        let html = invalid_page("https://a.test", InviteKind::New);
        assert!(
            html.contains(r#"<meta property="og:title" content="Esse convite não vale mais">"#)
        );
        assert!(html.contains("Quando chegar o link novo, é só clicar nele."));
        assert!(!html.contains("ashtar://"));
        assert!(!html.contains(r#"id="abrir""#));
    }
}
