/**
 * Porta de entrada da API (`api/`). O resto do app importa daqui, nunca dos arquivos da pasta.
 */
export { apiFetch, apiJson, jsonRequest } from "./client";
export { apiUrl } from "./config";
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
