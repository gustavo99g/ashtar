/**
 * Identidade. Espelha `commands/identity.rs`. A chave do computador fica no Rust: daqui só sai a
 * sessão.
 */
import { type InvokeArgs, invoke } from "@tauri-apps/api/core";
import type { SessionResponse } from "@/lib/api";
// Direto do arquivo, e não do `@/lib/api`: o `client.ts` de lá importa estes comandos (o 426).
import { errorFromCommand } from "@/lib/api/errors";
import { call } from "./core";
import { checkForUpdate } from "./updater";

/**
 * Chama um comando que fala com a API. A recusa não é um `AppError`: é o mesmo `ApiError` do
 * `apiFetch` (`@/lib/api`), com o `status` e o `kind` da API ou `network`, `timeout`,
 * `device_key`...
 */
async function callApi<T>(command: string, args?: InvokeArgs): Promise<T> {
	try {
		return await invoke<T>(command, args);
	} catch (rejection) {
		const error = errorFromCommand(rejection);
		if (error.kind === "client_outdated") {
			// Como no `apiFetch`: a versão nova provavelmente já está publicada.
			void checkForUpdate().catch(() => {});
		}
		throw error;
	}
}

/**
 * Entra com a chave deste computador (`POST /api/auth/login`). Rejeita com `unknown_device`
 * quando o computador não tem conta. Quem guarda o token é a `features/identity`.
 */
export function login() {
	return callApi<SessionResponse>("login");
}

/**
 * Entra com um convite (`POST /api/auth/redeem`). O `nick` é obrigatório no convite novo e
 * ignorado no de recuperação.
 */
export function redeem(code: string, nick: string | null) {
	return callApi<SessionResponse>("redeem", { code, nick });
}

/** De quem era a conta deste computador. Espelha `identity/marker.rs`. */
export interface AccountMarker {
	nick: string;
	display_name: string | null;
}

/**
 * O marcador gravado depois do último `login` ou `redeem` que deu certo, ou `null` se nenhum deu
 * certo neste computador. Separa "nunca entrou" de "saiu do grupo". Rejeita com um `AppError`.
 */
export function accountMarker() {
	return call<AccountMarker | null>("account_marker");
}
