/**
 * A janela do app, para a barra de título própria (`decorations: false` no `tauri.conf.json`).
 *
 * Fora do Tauri (o `pnpm dev` aberto no navegador) as funções não fazem nada: a barra aparece,
 * mas não há janela para mexer. As permissões estão na capability `default.json`.
 */
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { setStageFullscreen } from "./commands/app";

export function minimizeWindow(): void {
	if (isTauri()) void getCurrentWindow().minimize();
}

export function toggleMaximizeWindow(): void {
	if (isTauri()) void getCurrentWindow().toggleMaximize();
}

/**
 * Traz a janela para a frente com o foco do teclado. Soltar um arquivo vindo do Explorer não ativa a
 * janela: sem isto, o Enter seguinte iria para o Explorer.
 */
export function focusWindow(): void {
	if (isTauri()) void getCurrentWindow().setFocus();
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
export function watchWindowMinimized(
	onChange: (minimized: boolean) => void,
): () => void {
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

/**
 * Põe a janela em tela cheia (ou tira). É a tela cheia da transmissão: a do próprio WebView2
 * (`requestFullscreen`) numa janela sem a borda do Windows deixava, a cada segunda vez no mesmo
 * monitor, uma faixa branca sem desenhar. O Rust (`set_stage_fullscreen`) também avisa a barra de
 * tarefas, que senão ficava por cima a partir da segunda vez. Fora do Tauri não faz nada.
 */
export function setWindowFullscreen(on: boolean): void {
	if (isTauri()) void setStageFullscreen(on).catch(() => {});
}

/**
 * Avisa quando a janela sai da tela cheia por fora do app (o Windows, um atalho). Devolve a função
 * que para de escutar.
 */
export function watchWindowFullscreen(
	onChange: (fullscreen: boolean) => void,
): () => void {
	if (!isTauri()) return () => {};

	const window = getCurrentWindow();
	let stopped = false;
	const unlisten = window.onResized(() => {
		void window.isFullscreen().then((fullscreen) => {
			if (!stopped) onChange(fullscreen);
		});
	});
	return () => {
		stopped = true;
		void unlisten.then((stop) => stop());
	};
}
