import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
	ENTERING_TITLE_ID,
	Entering,
	EntryProblem,
	EntryScreen,
	loadOpeningLink,
	nextEntryPath,
	useOpeningLinkReady,
} from "@/features/entry";
import {
	type Session,
	startSession,
	useSession,
	useSessionStore,
} from "@/features/identity";

/**
 * A abertura do app ("Entrando…"): faz o login pela chave e lê o link que abriu o app, uma vez
 * cada, e manda para a tela certa (a regra está em `features/entry/destination.ts`). Com o link
 * e uma conta, o convite não é usado: vai para "Você já está no Ashtar".
 */
export function StartRoute() {
	const session = useSession();
	const linkReady = useOpeningLinkReady();
	const navigate = useNavigate();
	// A última sessão que já mandou para outra tela. O `StrictMode` roda o efeito duas vezes, e a
	// segunda vez não pode decidir de novo: o link já saiu da fila na primeira.
	const handled = useRef<Session | null>(null);

	useEffect(() => {
		// Só na abertura: voltar para cá com a sessão já resolvida não faz outro login.
		if (useSessionStore.getState().session.status === "entering") {
			void startSession();
		}
		void loadOpeningLink();
	}, []);

	useEffect(() => {
		if (!linkReady || handled.current === session) return;
		const path = nextEntryPath(session);
		if (path === null) return;
		handled.current = session;
		void navigate(path, { replace: true });
	}, [linkReady, session, navigate]);

	if (session.status === "error") {
		return (
			<EntryProblem error={session.error} onRetry={() => void startSession()} />
		);
	}

	return (
		<EntryScreen labelledBy={ENTERING_TITLE_ID}>
			<Entering />
		</EntryScreen>
	);
}
