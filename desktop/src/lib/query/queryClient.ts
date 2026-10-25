/**
 * O cache dos dados da API (TanStack Query) e as regras que valem para todas as consultas
 * (ADR 0012). As chaves e os hooks de cada assunto ficam no `queries.ts` da feature.
 */
import { QueryClient } from "@tanstack/react-query";
import { isRetryable } from "@/lib/api";

/** Quantas vezes uma consulta tenta de novo depois da primeira falha. */
const MAX_RETRIES = 2;

/**
 * Tenta de novo só o que pode dar certo na segunda vez: sem resposta, fim do tempo e erro do
 * servidor (5xx). Erro de regra (`forbidden`, `invalid_invite`, `client_outdated`...) falha na hora.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
	return failureCount < MAX_RETRIES && isRetryable(error);
}

export function createQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				retry: shouldRetry,
				// Os dados valem 30 s: trocar de tela não repete a chamada a cada vez.
				staleTime: 30_000,
				// Sem rede, a consulta falha com `network` (e a tela mostra "Sem conexão"), em vez
				// de ficar parada esperando o `navigator.onLine`.
				networkMode: "always",
			},
			mutations: {
				// Repetir um POST pode criar duas vezes (dois convites, por exemplo).
				retry: false,
				networkMode: "always",
			},
		},
	});
}

export const queryClient = createQueryClient();
