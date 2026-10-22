/**
 * Porta de entrada da API (`api/`). O resto do app importa daqui, nunca dos arquivos da pasta.
 */
export { ApiError, type ApiErrorKind, apiFetch } from "./client";
export { apiUrl } from "./config";
