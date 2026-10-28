/**
 * O link `ashtar://` (`ashtar-dev://` no app de desenvolvimento), pelo `tauri-plugin-deep-link`.
 *
 * Chega de dois jeitos: o link que abriu o app (o Windows passa o endereço ao processo novo) e os
 * que chegam com o app já aberto (o `single-instance` entrega o endereço à janela que existe).
 * Aqui só sai o texto do endereço: quem confere se é um convite é a `features/entry`.
 *
 * Fora do Tauri (o `pnpm dev` no navegador) não há link: as funções não fazem nada.
 */
import { isTauri } from "@tauri-apps/api/core";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";

/**
 * O link que abriu o app, ou `null` se ele abriu sem link (pelo menu Iniciar, pelo instalador).
 * Rejeita só se o Tauri falhar.
 */
export async function openingLink(): Promise<string | null> {
	if (!isTauri()) return null;
	const urls = await getCurrent();
	return urls?.[0] ?? null;
}

/**
 * Avisa cada link que chega com o app aberto. Devolve a função que para de escutar.
 *
 * O plugin entrega uma lista; com o `single-instance`, ela tem um endereço só.
 */
export function watchLinks(onLink: (url: string) => void): () => void {
	if (!isTauri()) return () => {};

	let stopped = false;
	const unlisten = onOpenUrl((urls) => {
		if (stopped) return;
		for (const url of urls) onLink(url);
	});
	return () => {
		stopped = true;
		void unlisten.then((stop) => stop());
	};
}
