/**
 * Se o app está à vista: a página visível e a janela fora do minimizado. Serve para as consultas
 * que repetem sozinhas (`refetchInterval`) pararem quando ninguém está olhando.
 *
 * O TanStack Query já para o `refetchInterval` com o `document.visibilityState` em "hidden", mas
 * o WebView2 pode continuar "visible" com a janela minimizada (ver `watchWindowMinimized`). Este
 * hook junta os dois.
 */
import { useEffect, useState } from "react";
import { watchWindowMinimized } from "./tauri/window";

function pageVisible(): boolean {
	return document.visibilityState !== "hidden";
}

export function useAppVisible(): boolean {
	const [page, setPage] = useState(pageVisible);
	const [minimized, setMinimized] = useState(false);

	useEffect(() => {
		const onChange = () => setPage(pageVisible());
		document.addEventListener("visibilitychange", onChange);
		const stopWatching = watchWindowMinimized(setMinimized);
		return () => {
			document.removeEventListener("visibilitychange", onChange);
			stopWatching();
		};
	}, []);

	return page && !minimized;
}

/**
 * Se a janela do app está em foco: à vista e sendo usada agora. É o que conta para dar uma mensagem
 * como lida (Etapa 13). Com o app na bandeja, minimizado ou atrás de outra janela, `false`.
 */
export function useAppFocused(): boolean {
	const visible = useAppVisible();
	const [focused, setFocused] = useState(() => document.hasFocus());

	useEffect(() => {
		const onFocus = () => setFocused(true);
		const onBlur = () => setFocused(false);
		window.addEventListener("focus", onFocus);
		window.addEventListener("blur", onBlur);
		// Pode ter mudado entre o primeiro desenho e o efeito.
		setFocused(document.hasFocus());
		return () => {
			window.removeEventListener("focus", onFocus);
			window.removeEventListener("blur", onBlur);
		};
	}, []);

	return visible && focused;
}
