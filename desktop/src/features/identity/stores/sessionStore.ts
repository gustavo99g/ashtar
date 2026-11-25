/**
 * A sessão deste computador: em que pé está a entrada na API e quem é a pessoa.
 *
 * O token não fica aqui: mora só na memória do `lib/api` (`setSessionToken`). Aqui fica o estado
 * que as telas leem para decidir o que mostrar, e as ações que o mudam:
 *
 * - `startSession`: o login pela chave deste computador. A `StartRoute` chama uma vez por
 *   abertura, e o "Tentar de novo" chama outra. Nunca tenta sozinho;
 * - `redeemInvite`: entrar com um convite (as telas da entrada, Etapa 4);
 * - `reauthenticate` e `setLeftGroup`: o que o `SessionWatcher` registra no `lib/api` para o 401.
 */
import { create } from "zustand";
import {
	APP_ERROR_MESSAGE,
	ApiError,
	clearSession,
	isApiError,
	type SessionResponse,
	setSessionToken,
	type UserView,
} from "@/lib/api";
import {
	type AccountMarker,
	accountMarker,
	login,
	redeem,
} from "@/lib/tauri/commands";

export type Session =
	/** O login pela chave está em andamento ("Entrando…"). */
	| { status: "entering" }
	/** Entrou: o token está no `lib/api`. */
	| { status: "connected"; user: UserView }
	/** Este computador nunca entrou: precisa de um convite. */
	| { status: "noAccount" }
	/**
	 * Este computador já teve uma conta, e a API não o reconhece mais. `account` diz de quem era
	 * (do marcador, ou da sessão que acabou de cair); `null` se não deu para saber.
	 */
	| { status: "leftGroup"; account: AccountMarker | null }
	/** O login falhou por outro motivo: sem rede, servidor, versão velha... O `kind` está no erro. */
	| { status: "error"; error: ApiError };

interface SessionState {
	session: Session;
}

/**
 * O estado da sessão. As telas leem com `useSession`; quem muda são as ações deste arquivo. O
 * store fica exportado para ler fora do React (`getState`) e para os testes prepararem um estado.
 */
export const useSessionStore = create<SessionState>()(() => ({
	session: { status: "entering" },
}));

export function useSession(): Session {
	return useSessionStore((state) => state.session);
}

function setSession(session: Session): void {
	useSessionStore.setState({ session });
}

/** Grava o token no `lib/api` e passa para "conectado". */
function connect(response: SessionResponse): UserView {
	setSessionToken(response.token);
	setSession({ status: "connected", user: response.user });
	return response.user;
}

let entering: Promise<void> | null = null;

/**
 * Faz o login pela chave deste computador e põe o resultado na sessão. Chamadas enquanto um
 * login está em andamento esperam o mesmo (o `StrictMode` monta a `StartRoute` duas vezes).
 * Resolve sempre: o resultado, inclusive o erro, fica na sessão.
 */
export function startSession(): Promise<void> {
	entering ??= enter().finally(() => {
		entering = null;
	});
	return entering;
}

async function enter(): Promise<void> {
	setSession({ status: "entering" });
	try {
		connect(await login());
	} catch (error) {
		setSession(await afterLoginFailure(error));
	}
}

async function afterLoginFailure(error: unknown): Promise<Session> {
	if (isApiError(error, "unknown_device")) {
		// O marcador separa "nunca entrou" de "saiu do grupo". Sem conseguir ler, vale o convite.
		const account = await accountMarker().catch(() => null);
		return account ? { status: "leftGroup", account } : { status: "noAccount" };
	}
	return { status: "error", error: asApiError(error) };
}

function asApiError(error: unknown): ApiError {
	if (isApiError(error)) return error;
	console.error("Erro ao abrir a sessão:", error);
	return new ApiError({ status: 0, kind: "app", message: APP_ERROR_MESSAGE });
}

/**
 * Entra com um convite: cria a conta (convite novo, com o `nick`) ou liga este computador a ela
 * (recuperação, `nick` `null`). Deu certo: a sessão fica conectada e resolve com o usuário.
 * Rejeita com o `ApiError` (`invalid_invite`, `nick_taken`, `invalid_nick`...).
 *
 * `device_already_linked` quer dizer que este computador já tem conta: faz o login (a sessão
 * fica conectada) e rejeita com o mesmo erro, para a tela mostrar "Você já está no Ashtar".
 */
export async function redeemInvite(
	code: string,
	nick: string | null,
): Promise<UserView> {
	try {
		return connect(await redeem(code, nick));
	} catch (error) {
		if (isApiError(error, "device_already_linked")) {
			connect(await login());
		}
		throw error;
	}
}

/**
 * O login de novo depois de um 401 no meio do uso, sem passar por "Entrando…": a tela fica onde
 * está. Rejeita com o erro do login; com `unknown_device`, o `lib/api` avisa "saiu do grupo".
 */
export async function reauthenticate(): Promise<void> {
	connect(await login());
}

/** O computador saiu do grupo no meio do uso: guarda de quem era a conta e esquece o token. */
export function setLeftGroup(): void {
	const current = useSessionStore.getState().session;
	const account =
		current.status === "connected"
			? { nick: current.user.nick, display_name: current.user.display_name }
			: null;
	clearSession();
	setSession({ status: "leftGroup", account });
}
