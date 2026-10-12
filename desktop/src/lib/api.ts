/**
 * Único ponto de chamada à API (`api/`). Acrescenta os cabeçalhos de versão e de código de acesso
 * (decisões 8 e 11 do PLAN), põe um limite de tempo e transforma as recusas em `ApiError` com uma
 * mensagem para a pessoa.
 *
 * Nenhum outro arquivo deve chamar `fetch` para a API diretamente.
 */
import { apiUrl } from "@/lib/config";
import { checkForUpdate } from "@/lib/tauri/commands";

/** Sem resposta nesse tempo, desiste (a API pode estar fora do ar, com o túnel caído). */
const TIMEOUT_MS = 10_000;

export type ApiErrorKind =
	| "client_outdated"
	| "access_denied"
	| "timeout"
	| "network"
	| "http";

export class ApiError extends Error {
	readonly kind: ApiErrorKind;

	constructor(kind: ApiErrorKind, message: string) {
		super(message);
		this.name = "ApiError";
		this.kind = kind;
	}
}

export async function apiFetch(
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	const headers = new Headers(init.headers);
	headers.set("X-App-Version", __APP_VERSION__);

	const accessCode = import.meta.env.VITE_ACCESS_CODE?.trim();
	if (accessCode) {
		headers.set("X-Access-Code", accessCode);
	}

	const timeout = AbortSignal.timeout(TIMEOUT_MS);
	let response: Response;
	try {
		response = await fetch(apiUrl(path), {
			...init,
			headers,
			signal: init.signal
				? AbortSignal.any([init.signal, timeout])
				: timeout,
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === "TimeoutError") {
			throw new ApiError(
				"timeout",
				"O servidor demorou demais para responder. Tente de novo em instantes.",
			);
		}
		throw new ApiError(
			"network",
			"Não foi possível falar com o servidor. Confira a internet ou tente mais tarde.",
		);
	}

	if (response.ok) {
		return response;
	}

	const body = (await response.json().catch(() => null)) as {
		message?: string;
	} | null;

	if (response.status === 426) {
		// A versão nova provavelmente já está publicada: verifica agora, sem esperar as 3 horas.
		void checkForUpdate().catch(() => {});
		throw new ApiError(
			"client_outdated",
			body?.message ?? "Esta versão do Ashtar é antiga demais. Atualize o app.",
		);
	}

	if (response.status === 401) {
		throw new ApiError(
			"access_denied",
			body?.message ?? "Acesso recusado pelo servidor.",
		);
	}

	throw new ApiError(
		"http",
		`O servidor respondeu com erro (${response.status}).`,
	);
}
