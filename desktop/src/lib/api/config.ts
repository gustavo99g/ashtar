/**
 * Configuração do app lida do ambiente.
 *
 * O `.env` fica na raiz do monorepo (`envDir` no `vite.config.ts`) e só variáveis com prefixo
 * `VITE_` chegam ao webview. O valor é gravado no bundle na hora do build: mudou o `.env`,
 * reinicie o `vite`/`tauri dev` ou gere o app de novo.
 */

/** Só no desenvolvimento: a API local (`api/`), para rodar sem configurar nada. */
const DEV_API_URL = "http://127.0.0.1:3000";

/**
 * Monta a URL de um endpoint da API a partir de `VITE_API_URL` (por exemplo
 * `apiUrl("/api/me")`). Sem a variável, só o desenvolvimento cai na API local; um app
 * gerado sem ela falha com uma mensagem clara, em vez de tentar `127.0.0.1` em silêncio.
 */
export function apiUrl(path: string): string {
	const configured = import.meta.env.VITE_API_URL?.trim();
	const base = configured || (import.meta.env.DEV ? DEV_API_URL : null);

	if (!base) {
		throw new Error(
			"VITE_API_URL não está configurada. Defina no .env da raiz e gere o app de novo.",
		);
	}

	return `${base.replace(/\/+$/, "")}${path}`;
}

/**
 * O endereço do WebSocket da API com o ticket: o mesmo da `VITE_API_URL`, com `ws` no lugar de
 * `http` (`https` vira `wss`).
 */
export function realtimeUrl(ticket: string): string {
	const query = new URLSearchParams({ ticket });
	return apiUrl(`/api/realtime?${query}`).replace(/^http/, "ws");
}
