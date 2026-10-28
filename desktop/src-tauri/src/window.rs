//! O tamanho da janela na primeira abertura (ADR 0012).
//!
//! O `tauri.conf.json` abre a janela em 1440 × 900, o tamanho dos quadros. Numa tela menor (um
//! notebook de 1366 × 768, ou 1920 × 1080 com a escala em 150%), isso passaria da área útil. Então,
//! quando o `tauri-plugin-window-state` ainda não gravou nada, a janela encolhe para caber em 90%
//! da área útil do monitor em que abriu (sem a barra de tarefas) e fica no meio dela. Com estado
//! gravado, vale o que a pessoa deixou. O mínimo de 1000 × 640 continua valendo: numa tela ainda
//! menor, o Windows segura a janela nele.
//!
//! Quem chama é o `lib.rs`: [`has_saved_state`] entre o `build()` e o `run()`, e
//! [`fit_to_monitor`] no `RunEvent::Ready`.

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_window_state::AppHandleExt;

/// Quanto da área útil do monitor a janela pode ocupar na primeira abertura.
const MAX_SHARE: f64 = 0.9;

/// Se o window-state já gravou o tamanho da janela numa abertura anterior.
///
/// Tem de rodar depois do `build()` (o plugin já leu o arquivo e sabe o nome dele) e antes do
/// `run()`: a janela nasce no começo do `run()`, e o plugin grava o arquivo nessa hora, mesmo na
/// primeira abertura. Por isso a conta não pode ficar no `setup`, que roda depois.
pub fn has_saved_state(app: &AppHandle) -> bool {
    match app.path().app_config_dir() {
        Ok(dir) => dir.join(app.filename()).exists(),
        Err(_) => false,
    }
}

/// Na primeira abertura, encolhe a janela para caber no monitor e a centraliza na área útil.
/// Se ela já cabe, não mexe: o `center` do `tauri.conf.json` já a pôs no meio.
pub fn fit_to_monitor(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let (Ok(Some(monitor)), Ok(size)) = (window.current_monitor(), window.inner_size()) else {
        tracing::warn!("não foi possível ler o monitor para ajustar a janela");
        return;
    };
    let area = monitor.work_area();
    let Some((size, position)) = fit(
        (size.width, size.height),
        (area.position.x, area.position.y),
        (area.size.width, area.size.height),
    ) else {
        return;
    };
    // Primeiro o tamanho, depois a posição: a posição é calculada para o tamanho novo.
    let resized = window
        .set_size(PhysicalSize::new(size.0, size.1))
        .and_then(|()| window.set_position(PhysicalPosition::new(position.0, position.1)));
    if let Err(error) = resized {
        tracing::warn!(%error, "não foi possível ajustar a janela ao monitor");
    }
}

/// A conta, em pixels físicos: o tamanho e a posição novos, ou `None` se a janela já cabe em 90%
/// da área útil (posição e tamanho da área, sem a barra de tarefas).
fn fit(
    window: (u32, u32),
    area_at: (i32, i32),
    area: (u32, u32),
) -> Option<((u32, u32), (i32, i32))> {
    let max_width = (f64::from(area.0) * MAX_SHARE) as u32;
    let max_height = (f64::from(area.1) * MAX_SHARE) as u32;
    if window.0 <= max_width && window.1 <= max_height {
        return None;
    }
    let size = (window.0.min(max_width), window.1.min(max_height));
    // As metades cabem em i32: a área de um monitor não passa de alguns milhares de pixels.
    let x = area_at.0 + ((area.0 - size.0) / 2) as i32;
    let y = area_at.1 + ((area.1 - size.1) / 2) as i32;
    Some((size, (x, y)))
}

/// Mostra a janela principal na frente das outras: tira do minimizado, mostra e dá o foco.
///
/// Chamada pelo `single-instance` quando outro processo do app é aberto e pelo ícone da bandeja
/// (`tray.rs`), que esconde a janela em vez de fechá-la. O processo novo já
/// passou ao Windows a permissão de trazer esta janela para a frente; sem ela, o Windows só
/// piscaria o ícone na barra de tarefas.
pub fn bring_to_front(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        tracing::warn!("pediram a janela, mas ela não existe");
        return;
    };
    // Cada passo vale sozinho: se um falhar, os outros ainda ajudam.
    if let Err(error) = window.unminimize() {
        tracing::warn!(%error, "não foi possível tirar a janela do minimizado");
    }
    if let Err(error) = window.show() {
        tracing::warn!(%error, "não foi possível mostrar a janela");
    }
    if let Err(error) = window.set_focus() {
        tracing::warn!(%error, "não foi possível dar o foco à janela");
    }
}

#[cfg(test)]
mod tests {
    use super::fit;

    #[test]
    fn cabe_numa_tela_grande_e_nao_mexe() {
        // 1920 × 1080 em 100%, barra de tarefas de 48 px: área de 1920 × 1032.
        assert_eq!(fit((1440, 900), (0, 0), (1920, 1032)), None);
    }

    #[test]
    fn encolhe_num_notebook_e_centraliza_na_area_util() {
        // 1366 × 768 em 100%, barra de 40 px: área de 1366 × 728; 90% = 1229 × 655.
        assert_eq!(
            fit((1440, 900), (0, 0), (1366, 728)),
            Some(((1229, 655), (68, 36)))
        );
    }

    #[test]
    fn com_escala_a_conta_e_em_pixels_fisicos() {
        // 1920 × 1080 em 150%: a janela de 1440 × 900 lógicos tem 2160 × 1350 físicos.
        assert_eq!(
            fit((2160, 1350), (0, 0), (1920, 1032)),
            Some(((1728, 928), (96, 52)))
        );
    }

    #[test]
    fn so_a_medida_que_passa_encolhe() {
        // Larga o bastante, baixa demais (2560 × 800, área de 2560 × 760): só a altura muda.
        assert_eq!(
            fit((1440, 900), (0, 0), (2560, 760)),
            Some(((1440, 684), (560, 38)))
        );
    }

    #[test]
    fn respeita_a_posicao_do_monitor() {
        // Um segundo monitor à esquerda do principal, com a área começando em x = -1366.
        assert_eq!(
            fit((1440, 900), (-1366, 0), (1366, 728)),
            Some(((1229, 655), (-1298, 36)))
        );
    }
}
