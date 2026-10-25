/**
 * Porta de entrada da API (`api/`). O resto do app importa daqui, nunca dos arquivos da pasta (a
 * exceção é o `lib/tauri/commands.ts`, que usa o `errors.ts` direto para não fechar um ciclo).
 *
 * As funções por assunto (`me.ts`, `invites.ts`, `members.ts`, `voice.ts`) não usam React: os
 * hooks com o cache ficam no `queries.ts` de cada feature.
 */
export { apiFetch, apiJson, jsonRequest } from "./client";
export { apiUrl } from "./config";
export * from "./endpoints";
export {
	ApiError,
	type ApiErrorKind,
	type ClientErrorKind,
	isApiError,
	isRetryable,
} from "./errors";
// Os tipos das respostas e dos pedidos, gerados do Rust da API (`cargo test` em `api/`).
export type * from "./generated";
export {
	clearSession,
	type SessionHandlers,
	setSessionHandlers,
	setSessionToken,
} from "./session";
