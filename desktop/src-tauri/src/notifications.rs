//! Os avisos do Ashtar (Etapa 15 da v0.3, ADR 0022): uma janela própria no canto da tela, e o ponto
//! de não lido na bandeja e na barra de tarefas.
//!
//! **Por que uma janela própria, e não a notificação do Windows.** O experimento da Etapa 6
//! (`experiments/notify-probe`) mostrou as duas funcionando, e a escolha foi pelo aviso próprio: ele
//! tem a cara do app, empilha do jeito que a gente quer (três cartões, o mais novo empurra o mais
//! antigo) e não rouba o foco. O preço: o Windows não sabe que ele é uma notificação, então não o
//! segura no "Não incomodar" nem o guarda na central. Por isso, antes de mostrar, [`is_quiet`]
//! pergunta ao Windows se é hora de silêncio (jogo ou app em tela cheia, apresentação, tela
//! bloqueada). O "Não incomodar" do Windows não tem resposta pública; quem quer silêncio no Ashtar
//! usa o status Ocupado.
//!
//! **A janela** ([`create`]) nasce escondida no `setup`, com o rótulo [`LABEL`], e carrega a página
//! `notifications.html` uma vez só: quando o primeiro aviso chega, ela já está pronta para ouvir.
//! Não tem borda, fica sempre no topo, fora da barra de tarefas e, como a principal, fora de toda
//! captura de tela. Quem decide o que entra nela é a página: o Rust só repassa o cartão
//! ([`NOTIFICATION_CARD`]) e, quando a página diz a altura da pilha ([`place`]), põe a janela no
//! canto de baixo à direita da área útil do monitor principal, mostra ou esconde.
//!
//! **O clique** num cartão chega pelo comando `notification_open`: a janela principal vem para a
//! frente e recebe o alvo ([`NOTIFICATION_OPEN`]), para abrir a conversa, o canal ou a sala.
//!
//! **A ligação recebida** (ADR 0023) é mais um cartão nesta janela, no topo da pilha
//! ([`NOTIFICATION_RING`]), e o toque sai daqui. Ela não passa pelo [`is_quiet`]: uma ligação
//! aparece mesmo com um jogo em tela cheia. Os botões dela voltam para a janela principal
//! ([`NOTIFICATION_ANSWER`]), que é quem tem a sessão.
//!
//! **O ponto no ícone** ([`set_badge`]): o ícone da bandeja ganha uma bolinha e a janela principal
//! ganha o selo na barra de tarefas. Vermelha com não lidas; dourada transmitindo a tela (v0.8),
//! que ganha da vermelha. O selo é de janela: com o app na bandeja, só a bolinha aparece, e o selo
//! volta junto com a janela.

use tauri::image::Image;
use tauri::{
    App, AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder,
};

/// O rótulo da janela dos avisos.
pub const LABEL: &str = "notifications";

/// O evento que leva um cartão à janela dos avisos (contrato com o frontend).
pub const NOTIFICATION_CARD: &str = "notification-card";

/// O evento que leva à janela principal o alvo de um cartão clicado (contrato com o frontend).
pub const NOTIFICATION_OPEN: &str = "notification-open";

/// O evento que leva à janela dos avisos o cartão da ligação recebida, ou `null` para tirá-lo
/// (contrato com o frontend, ADR 0023).
pub const NOTIFICATION_RING: &str = "notification-ring";

/// O evento que leva à janela principal o botão apertado no cartão da ligação (contrato com o
/// frontend).
pub const NOTIFICATION_ANSWER: &str = "notification-answer";

/// A largura da janela, em pixels lógicos: a do cartão mais a sombra.
const WIDTH: f64 = 376.0;

/// A distância da janela até as bordas da área útil, em pixels lógicos.
const MARGIN: f64 = 12.0;

/// A cor da bolinha de não lidas: o `--destructive` do tema escuro.
const DOT: [u8; 4] = [0xED, 0x42, 0x45, 0xFF];
/// A cor da bolinha de transmitindo: o `--gold` do tema escuro.
const SHARING_DOT: [u8; 4] = [0xF6, 0xC2, 0x28, 0xFF];

/// O que a bolinha do ícone diz.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Badge {
    None,
    /// Conversa privada com não lida, ou menção: vermelha.
    Unread,
    /// Transmitindo a tela: dourada, no lugar da vermelha.
    Sharing,
}

impl Badge {
    fn color(self) -> Option<[u8; 4]> {
        match self {
            Self::None => None,
            Self::Unread => Some(DOT),
            Self::Sharing => Some(SHARING_DOT),
        }
    }
}

/// Cria a janela dos avisos, escondida. Falhar só deixa o app sem avisos.
pub fn create(app: &App) {
    let built = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("notifications.html".into()))
        .title("Ashtar")
        .inner_size(WIDTH, 1.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build();
    if let Err(error) = built {
        tracing::warn!(%error, "não foi possível criar a janela dos avisos");
    }
}

/// Põe a janela dos avisos no canto com a altura da pilha, em pixels lógicos. Zero esconde.
pub fn place(app: &AppHandle, height: f64) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(LABEL) else {
        return Ok(());
    };
    if height <= 0.0 {
        return window.hide();
    }
    window.set_size(LogicalSize::new(WIDTH, height))?;
    if let Some(monitor) = window.primary_monitor()? {
        let area = monitor.work_area();
        let (x, y) = corner(
            (area.position.x, area.position.y),
            (area.size.width, area.size.height),
            (WIDTH, height),
            monitor.scale_factor(),
        );
        window.set_position(PhysicalPosition::new(x, y))?;
    }
    // Criada com `focused(false)`, ela aparece sem tirar o foco de quem está digitando (o
    // experimento conferiu).
    if !window.is_visible()? {
        window.show()?;
    }
    Ok(())
}

/// O canto de baixo à direita da área útil (sem a barra de tarefas), em pixels físicos, para uma
/// janela de `size` lógicos.
fn corner(area_at: (i32, i32), area: (u32, u32), size: (f64, f64), scale: f64) -> (i32, i32) {
    let margin = MARGIN * scale;
    let x = f64::from(area_at.0) + f64::from(area.0) - size.0 * scale - margin;
    let y = f64::from(area_at.1) + f64::from(area.1) - size.1 * scale - margin;
    (x.round() as i32, y.round() as i32)
}

/// Se o Windows pede silêncio agora: um jogo ou app em tela cheia, uma apresentação, a tela
/// bloqueada. Nesses casos o aviso não aparece (o ponto de não lido, sim). Fora do Windows, nunca.
pub fn is_quiet() -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::{
            SHQueryUserNotificationState, QUERY_USER_NOTIFICATION_STATE, QUNS_ACCEPTS_NOTIFICATIONS,
        };
        let mut state: QUERY_USER_NOTIFICATION_STATE = 0;
        // SAFETY: a função só escreve no `state`, que vive até o fim do bloco.
        let result = unsafe { SHQueryUserNotificationState(&mut state) };
        if result != 0 {
            // Sem resposta, mostra: perder um aviso é pior do que mostrar um a mais.
            tracing::warn!(result, "SHQueryUserNotificationState falhou");
            return false;
        }
        state != QUNS_ACCEPTS_NOTIFICATIONS
    }
    #[cfg(not(windows))]
    false
}

/// Troca o ponto do ícone: a bolinha no ícone da bandeja e o selo na barra de tarefas.
pub fn set_badge(app: &AppHandle, badge: Badge) {
    let Some(icon) = app.default_window_icon().cloned() else {
        return;
    };
    let color = badge.color();
    if let Some(tray) = app.tray_by_id("main") {
        let icon = match color {
            Some(color) => with_dot(&icon, color),
            None => icon.to_owned(),
        };
        if let Err(error) = tray.set_icon(Some(icon)) {
            tracing::warn!(%error, "não foi possível trocar o ícone da bandeja");
        }
    }
    #[cfg(windows)]
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.set_overlay_icon(color.map(|color| dot(32, color))) {
            tracing::warn!(%error, "não foi possível pôr o selo na barra de tarefas");
        }
    }
}

/// Um ícone quadrado só com a bolinha: o selo da barra de tarefas.
#[cfg_attr(not(windows), allow(dead_code))]
fn dot(size: u32, color: [u8; 4]) -> Image<'static> {
    let mut rgba = vec![0u8; (size * size * 4) as usize];
    let center = (size as f32 - 1.0) / 2.0;
    paint_circle(
        &mut rgba,
        size,
        (center, center),
        size as f32 / 2.0 - 1.0,
        color,
    );
    Image::new_owned(rgba, size, size)
}

/// O ícone do app com a bolinha no canto de baixo à direita: o da bandeja com não lidas.
fn with_dot(icon: &Image<'_>, color: [u8; 4]) -> Image<'static> {
    let (width, height) = (icon.width(), icon.height());
    let mut rgba = icon.rgba().to_vec();
    let radius = width as f32 * 0.28;
    let center = (width as f32 - radius - 1.0, height as f32 - radius - 1.0);
    paint_circle(&mut rgba, width, center, radius, color);
    Image::new_owned(rgba, width, height)
}

/// Pinta um círculo cheio de `color` numa imagem RGBA de `width` de largura.
fn paint_circle(rgba: &mut [u8], width: u32, center: (f32, f32), radius: f32, color: [u8; 4]) {
    let height = rgba.len() as u32 / 4 / width;
    for y in 0..height {
        for x in 0..width {
            let (dx, dy) = (x as f32 - center.0, y as f32 - center.1);
            if dx * dx + dy * dy <= radius * radius {
                let i = ((y * width + x) * 4) as usize;
                rgba[i..i + 4].copy_from_slice(&color);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn o_canto_desconta_a_barra_de_tarefas_e_a_margem() {
        // 1920 × 1080 em 100%, barra de 48 px embaixo: área de 1920 × 1032.
        assert_eq!(
            corner((0, 0), (1920, 1032), (376.0, 200.0), 1.0),
            (1532, 820)
        );
    }

    #[test]
    fn com_escala_a_conta_e_em_pixels_fisicos() {
        // 150%: a janela de 376 × 200 lógicos tem 564 × 300 físicos, e a margem, 18.
        assert_eq!(
            corner((0, 0), (1920, 1032), (376.0, 200.0), 1.5),
            (1338, 714)
        );
    }

    #[test]
    fn respeita_a_posicao_do_monitor() {
        assert_eq!(
            corner((-1366, 0), (1366, 728), (376.0, 100.0), 1.0),
            (-388, 616)
        );
    }

    #[test]
    fn a_bolinha_fica_no_canto_e_o_resto_do_icone_nao_muda() {
        let icon = Image::new_owned(vec![0x10; 32 * 32 * 4], 32, 32);
        let marked = with_dot(&icon, DOT);
        let pixel = |x: u32, y: u32| {
            let i = ((y * 32 + x) * 4) as usize;
            marked.rgba()[i..i + 4].to_vec()
        };
        assert_eq!(pixel(25, 25), DOT.to_vec());
        assert_eq!(pixel(2, 2), vec![0x10; 4]);
    }

    #[test]
    fn o_selo_e_um_circulo_com_o_fundo_transparente() {
        let badge = dot(32, SHARING_DOT);
        let pixel = |x: u32, y: u32| {
            let i = ((y * 32 + x) * 4) as usize;
            badge.rgba()[i..i + 4].to_vec()
        };
        assert_eq!(pixel(16, 16), SHARING_DOT.to_vec());
        assert_eq!(pixel(0, 0), vec![0; 4]);
        assert_eq!(Badge::None.color(), None);
        assert_eq!(Badge::Unread.color(), Some(DOT));
    }
}
