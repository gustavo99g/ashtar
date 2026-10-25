import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSessionStore } from "@/features/identity";
import { watchLinks } from "@/lib/tauri/deep-link";
import { entryDestination } from "./destination";
import { parseInviteLink } from "./inviteLink";
import { keepPendingLink } from "./pendingLink";

/**
 * Escuta os links `ashtar://` que chegam com o app aberto (o `single-instance` já trouxe a janela
 * para a frente) e leva para a tela certa: com conta, "Você já está no Ashtar"; sem conta, o
 * convite. Com a abertura em andamento ou num erro, o link espera a sessão resolver. Um link que
 * não é convite é ignorado. Não desenha nada.
 *
 * Fica no `RootLayout`, abaixo do router e acima de todas as telas.
 */
export function LinkWatcher() {
	const navigate = useNavigate();

	useEffect(
		() =>
			watchLinks((url) => {
				const link = parseInviteLink(url);
				if (link === null) return;

				const path = entryDestination(useSessionStore.getState().session, link);
				if (path === null) {
					keepPendingLink(link);
				} else {
					void navigate(path, { replace: true });
				}
			}),
		[navigate],
	);

	return null;
}