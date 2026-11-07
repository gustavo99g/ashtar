/**
 * Único ponto de chamada à API (`api/`). Acrescenta os cabeçalhos de versão, de código de acesso
 * (decisões 8 e 11 da v0.2.0) e da sessão, põe um limite de tempo e transforma toda recusa num
 * `ApiError` com o `kind` da API.
 *
 * Um 401 `unauthenticated` com sessão faz o login de novo uma vez (`sessionStore.ts`) e repete a
 * chamada uma vez. Nenhum outro arquivo deve chamar `fetch` para a API.
 */
import { checkForUpdate } from "@/lib/tauri/commands";
import { apiUrl } from "./config";
import {
	ApiError,
	errorFromResponse,
	NETWORK_MESSAGE,
	TIMEOUT_MESSAGE,
} from "./errors";
import { renewSession, sessionToken } from "./session";

/** Sem resposta nesse tempo, desiste (a API pode estar fora do ar, com o túnel caído). */
const TIMEOUT_MS = 10_000;

/**
 * Chama a API. Resolve com a resposta quando ela dá certo (2xx) e rejeita com um `ApiError` em
 * qualquer outro caso. O `body` precisa ser texto (`JSON.stringify`), porque um 401 repete o
 * pedido.
 */
export async function apiFetch(
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	const sent = sessionToken();
	const response = await send(path, init, sent);
	if (response.ok) return response;

	let error = await failure(response);
	if (
		error.kind === "unauthenticated" &&
		sent !== null &&
		(await renewSession(sent))
	) {
		const retried = await send(path, init, sessionToken());
		if (retried.ok) return retried;
		error = await failure(retried);
	}
	throw error;
}

/** Chama a API e lê o JSON da resposta. */
export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await apiFetch(path, init);
	return (await response.json()) as T;
}

/** O `init` de um pedido com corpo JSON. */
export function jsonRequest(method: string, body: unknown): RequestInit {
	return {
		method,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	};
}

async function send(
	path: string,
	init: RequestInit,
	token: string | null,
): Promise<Response> {
	const headers = new Headers(init.headers);
	headers.set("X-App-Version", __APP_VERSION__);

	if (token) {
		headers.set("Authorization", `Bearer ${token}`);
	}

	const timeout = AbortSignal.timeout(TIMEOUT_MS);
	try {
		return await fetch(apiUrl(path), {
			...init,
			headers,
			signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
		});
	} catch (error) {
		// Quem chamou cancelou (o TanStack Query faz isso): não é falha de rede.
		if (init.signal?.aborted) throw error;
		if (error instanceof DOMException && error.name === "TimeoutError") {
			throw new ApiError({
				status: 0,
				kind: "timeout",
				message: TIMEOUT_MESSAGE,
			});
		}
		throw new ApiError({
			status: 0,
			kind: "network",
			message: NETWORK_MESSAGE,
		});
	}
}

/** O `ApiError` de uma resposta que não deu certo. */
async function failure(response: Response): Promise<ApiError> {
	const body: unknown = await response.json().catch(() => null);
	const error = errorFromResponse(response.status, body);

	if (error.kind === "client_outdated") {
		// A versão nova provavelmente já está publicada: verifica agora, sem esperar as 3 horas.
		void checkForUpdate().catch(() => {});
	}
	return error;
}
