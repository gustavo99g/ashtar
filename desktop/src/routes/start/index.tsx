import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { ErrorState, OfflineState } from "@/components/ui/states";
import { startSession, useSession, useSessionStore } from "@/features/identity";
import { paths } from "@/lib/paths";
import { RoutePlaceholder } from "../placeholder";

/**
 * A abertura do app ("Entrando…"): faz o login pela chave uma vez e manda para o servidor ou para
 * a entrada. A Etapa 4 desenha a tela, os erros e o caminho de quem chegou por um link.
 */
export function StartRoute() {
	const session = useSession();

	useEffect(() => {
		// Só na abertura: voltar para cá com a sessão já resolvida não faz outro login.
		if (useSessionStore.getState().session.status === "entering") {
			void startSession();
		}
	}, []);

	switch (session.status) {
		case "entering":
			return <RoutePlaceholder title="Entrando…" stage={4} />;
		case "connected":
			return <Navigate to={paths.server} replace />;
		case "noAccount":
			return <Navigate to={paths.entry.noInvite} replace />;
		case "leftGroup":
			return <Navigate to={paths.entry.leftGroup} replace />;
		case "error": {
			const retry = () => void startSession();
			const offline =
				session.error.kind === "network" || session.error.kind === "timeout";
			return (
				<div className="grid h-full place-items-center p-8">
					{offline ? (
						<OfflineState onRetry={retry} />
					) : (
						<ErrorState
							title="Não foi possível entrar"
							description={session.error.message}
							onRetry={retry}
						/>
					)}
				</div>
			);
		}
	}
}
