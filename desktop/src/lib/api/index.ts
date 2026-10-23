/**
 * Porta de entrada da API (`api/`). O resto do app importa daqui, nunca dos arquivos da pasta.
 */
export { ApiError, type ApiErrorKind, apiFetch } from "./client";
export { apiUrl } from "./config";
// Os tipos das respostas e dos pedidos, gerados do Rust da API (`cargo test` em `api/`).
export type * from "./generated";
