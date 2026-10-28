/**
 * Registro dos temas. O CSS de cada um fica nesta pasta (`<id>.css`) e entra pelo `App.css`.
 *
 * Tema novo: crie o `<id>.css` preenchendo o contrato, importe no `App.css` e acrescente aqui.
 * O `pnpm check:themes` confere os três passos.
 */
export const THEMES = [{ id: "ashtar-dark", label: "Escuro" }] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

/** O mesmo do `data-theme` do `index.html`, para a primeira pintura já sair certa. */
export const DEFAULT_THEME: ThemeId = "ashtar-dark";

export function isThemeId(value: unknown): value is ThemeId {
	return THEMES.some((theme) => theme.id === value);
}

/** Troca o tema da janela inteira: os tokens leem o `data-theme` do `<html>`. */
export function applyTheme(id: ThemeId) {
	document.documentElement.dataset.theme = id;
}
