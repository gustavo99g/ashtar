import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/components/ui/toast";
import { useSessionStore } from "@/features/identity";
import { watchLinks } from "@/lib/tauri/deep-link";
import { entryDestination } from "../model/destination";
import { parseInviteLink } from "../model/inviteLink";
import { keepPendingLink } from "../stores/pendingLinkStore";

/**
 * Escuta os links `ashtar://` que chegam com o app aberto (o `single-instance` já trouxe a janela
 * para a frente) e leva para a tela certa:
 *
 * - com conta: só um aviso no canto, **sem trocar de tela**. A pessoa pode estar numa chamada, e o
 *   convite não tem o que fazer aqui. A tela "Você já está no Ashtar" é para quem abriu o app
 *   pelo link (`routes/start`), que ainda não estava em lugar nenhum;
 * - sem conta: o convite. Não há tela a perder, a pessoa está na entrada;
 * - com a abertura em andamento ou num erro: o link espera a sessão resolver.
 *
 * Um link que não é convite é ignorado. Não desenha nada.
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

				const session = useSessionStore.getState().session;
				if (session.status === "connected") {
					toast.add({
						title: "Você já está no Ashtar",
						description:
							"Esse convite não foi usado. Ele continua valendo para outra pessoa.",
					});
					return;
				}

				const path = entryDestination(session, link);
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
