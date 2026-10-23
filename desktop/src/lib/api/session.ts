/**
 * A sessão: o token só na memória (ADR 0013) e quem a renova quando a API responde 401.
 *
 * O `lib/api` não pode importar a feature `identity` (regra de pastas da ADR 0012). Ela registra
 * aqui, ao abrir o app, como entrar de novo (`reauthenticate`) e o que fazer quando este
 * computador saiu do grupo (`onLeftGroup`).
 */
import { isApiError } from "./errors";

export interface SessionHandlers {
	/** Faz o login de novo e grava o token novo com `setSessionToken`. Rejeita com um `ApiError`. */
	reauthenticate: () => Promise<void>;
	/** O login de novo respondeu `unknown_device`: o computador saiu do grupo. */
	onLeftGroup: () => void;
}

let token: string | null = null;
let handlers: SessionHandlers | null = null;
let renewing: Promise<void> | null = null;

/** Guarda o token do `login` ou do `redeem`. Nunca vai para o disco. */
export function setSessionToken(value: string): void {
	token = value;
}

export function clearSession(): void {
	token = null;
}

export function sessionToken(): string | null {
	return token;
}

/** Registra os handlers. Devolve a função que desfaz o registro. */
export function setSessionHandlers(next: SessionHandlers): () => void {
	handlers = next;
	return () => {
		if (handlers === next) handlers = null;
	};
}

/**
 * Depois de um 401 com o token `rejected`: faz o login de novo e diz se há um token novo para
 * repetir a chamada. Várias chamadas que recebem 401 juntas esperam o mesmo login, e o
 * `onLeftGroup` roda uma vez só.
 */
export async function renewSession(rejected: string): Promise<boolean> {
	// Outra chamada já renovou enquanto esta esperava a resposta.
	if (token !== null && token !== rejected) return true;
	if (!handlers) return false;

	const current = handlers;
	renewing ??= current
		.reauthenticate()
		.catch((error: unknown) => {
			if (isApiError(error, "unknown_device")) {
				clearSession();
				current.onLeftGroup();
			}
			throw error;
		})
		.finally(() => {
			renewing = null;
		});

	await renewing;
	return token !== null && token !== rejected;
}
