/**
 * O erro de toda chamada à API, venha ela do `apiFetch` ou dos comandos `login` e `redeem` do Rust
 * (`@/lib/tauri/commands`). As telas decidem pelo `kind`, nunca pela mensagem.
 *
 * Este arquivo só importa tipos: o `lib/tauri` usa a mesma classe sem criar um ciclo com o
 * `client.ts`, que importa o `lib/tauri` por causa do 426.
 */
import type { ErrorKind, InviteRefusal } from "./generated";

/**
 * Os `kind` que nascem no app, não na API. O Rust (`src-tauri/src/api.rs`) usa os mesmos textos.
 *
 * - `network`: nenhuma resposta (sem internet, API fora do ar, túnel caído);
 * - `timeout`: a API não respondeu em 10 segundos;
 * - `http`: uma resposta de erro sem o corpo da API (um 502 do túnel, por exemplo);
 * - `device_key`: o Rust não conseguiu a chave deste computador;
 * - `app`: o próprio app falhou ao chamar o comando.
 */
export type ClientErrorKind =
	| "network"
	| "timeout"
	| "http"
	| "device_key"
	| "app";

/** Os `kind` da API (gerados do Rust) e os do app. */
export type ApiErrorKind = ErrorKind | ClientErrorKind;

export const NETWORK_MESSAGE =
	"Não foi possível falar com o servidor. Confira a internet ou tente mais tarde.";
export const TIMEOUT_MESSAGE =
	"O servidor demorou demais para responder. Tente de novo em instantes.";

export class ApiError extends Error {
	/** O status HTTP da resposta; 0 quando não houve resposta. */
	readonly status: number;
	readonly kind: ApiErrorKind;
	/** Só no `client_outdated` (426): a versão mínima que a API aceita. */
	readonly minVersion: string | null;
	/** Só no `invalid_invite` (v0.9): por que o convite foi recusado. O servidor antigo não manda. */
	readonly reason: InviteRefusal | null;

	constructor(init: {
		status: number;
		kind: ApiErrorKind;
		message: string;
		minVersion?: string | null;
		reason?: InviteRefusal | null;
	}) {
		super(init.message);
		this.name = "ApiError";
		this.status = init.status;
		this.kind = init.kind;
		this.minVersion = init.minVersion ?? null;
		this.reason = init.reason ?? null;
	}
}

/** Se `error` é um `ApiError` (e, com `kind`, se é desse tipo). */
export function isApiError(
	error: unknown,
	kind?: ApiErrorKind,
): error is ApiError {
	return (
		error instanceof ApiError && (kind === undefined || error.kind === kind)
	);
}

/**
 * Vale tentar de novo: sem resposta, fim do tempo ou erro do servidor (5xx). Um erro de regra
 * (`forbidden`, `invalid_invite`, `client_outdated`...) daria o mesmo resultado na segunda vez.
 */
export function isRetryable(error: unknown): boolean {
	return (
		error instanceof ApiError &&
		(error.kind === "network" ||
			error.kind === "timeout" ||
			error.status >= 500)
	);
}

interface ErrorFields {
	kind: string;
	message: string;
	min_version?: string;
	reason?: InviteRefusal;
}

function hasErrorFields(value: unknown): value is ErrorFields {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as ErrorFields).kind === "string" &&
		typeof (value as ErrorFields).message === "string"
	);
}

/** O texto de um erro do próprio app (o detalhe fica no log). */
export const APP_ERROR_MESSAGE =
	"Algo deu errado no app. Tente de novo; se continuar, use Enviar logs em Configurações › Aplicativo.";

/** O erro de uma resposta que não deu certo, lido do corpo `{ kind, message, min_version?, reason? }`. */
export function errorFromResponse(status: number, body: unknown): ApiError {
	if (hasErrorFields(body)) {
		return new ApiError({
			status,
			kind: body.kind as ApiErrorKind,
			message: body.message,
			minVersion: body.min_version,
			reason: body.reason,
		});
	}
	return new ApiError({
		status,
		kind: "http",
		message: "O servidor não respondeu direito. Tente de novo em instantes.",
	});
}

/**
 * O erro de um comando do Rust que chama a API. Ele rejeita com `{ status, kind, message,
 * min_version? }`; qualquer outra coisa (um erro do próprio Tauri, que chega como texto) vira
 * `app`.
 */
export function errorFromCommand(value: unknown): ApiError {
	if (
		hasErrorFields(value) &&
		"status" in value &&
		typeof value.status === "number"
	) {
		return new ApiError({
			status: value.status,
			kind: value.kind as ApiErrorKind,
			message: value.message,
			minVersion: value.min_version,
			reason: value.reason,
		});
	}
	// O detalhe (um erro do Tauri, em inglês) vai para o log; a pessoa vê o que fazer.
	console.error("Erro do app ao falar com o servidor:", value);
	return new ApiError({
		status: 0,
		kind: "app",
		message: APP_ERROR_MESSAGE,
	});
}
