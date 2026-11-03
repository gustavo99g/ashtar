/**
 * Abre um link no navegador do computador, nunca dentro do app. Só `http` e `https`: o resto
 * (um `file://` colado no chat, por exemplo) não abre.
 */
import { openUrl } from "@tauri-apps/plugin-opener";

export function isWebLink(url: string): boolean {
	return /^https?:\/\//i.test(url);
}

export function openLink(url: string): void {
	if (!isWebLink(url)) return;
	void openUrl(url).catch(() => {});
}
