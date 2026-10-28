/**
 * A janela do app, para a barra de título própria (`decorations: false` no `tauri.conf.json`).
 *
 * Fora do Tauri (o `pnpm dev` aberto no navegador) as funções não fazem nada: a barra aparece,
 * mas não há janela para mexer. As permissões estão na capability `default.json`.
 */
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function minimizeWindow(): void {
	if (isTauri()) void getCurrentWindow().minimize();
}

export function toggleMaximizeWindow(): void {
	if (isTauri()) void getCurrentWindow().toggleMaximize();
}

/** Fecha a janela. O Rust a esconde na bandeja (`tray.rs`): o app continua aberto, e só o "Sair" da bandeja o encerra. */
export function closeWindow(): void {
	if (isTauri()) void getCurrentWindow().close();
}

/**
 * Avisa se a janela está maximizada agora e a cada mudança de tamanho (maximizar, restaurar,
 * encaixar com Win + setas). Devolve a função que para de escutar.
 */
export function watchWindowMaximized(
	onChange: (maximized: boolean) => void,
): () => void {
	if (!isTauri()) return () => {};

	const window = getCurrentWindow();
	let stopped = false;
	const check = () => {
		void window.isMaximized().then((maximized) => {
			if (!stopped) onChange(maximized);
		});
	};

	check();
	const unlisten = window.onResized(check);
	return () => {
		stopped = true;
		void unlisten.then((stop) => stop());
	};
}
/**
 * Avisa se a janela está minimizada agora e a cada mudança de tamanho. O WebView2 não diz isso à
 * página: o wry não esconde o webview ao minimizar, então o `document.visibilityState` pode
 * continuar "visible". Devolve a função que para de escutar.
 */
export function watchWindowMinimized(onChange: (minimized: boolean) => void): () => void {
	if (!isTauri()) return () => {};

	const window = getCurrentWindow();
	let stopped = false;
	const check = () => {
		void window.isMinimized().then((minimized) => {
			if (!stopped) onChange(minimized);
		});
	};

	check();
	const unlisten = window.onResized(check);
	return () => {
		stopped = true;
		void unlisten.then((stop) => stop());
	};
}
