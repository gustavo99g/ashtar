/**
 * O convite que chegou pelo link e ainda espera a abertura decidir para onde ir.
 *
 * O link que abriu o app chega antes de o login terminar: fica guardado aqui até a sessão
 * resolver, e quem o usa tira daqui (`nextEntryPath`). Um link que chega com o app aberto vai
 * direto para a tela (`LinkWatcher`), a não ser que a abertura ainda esteja em "Entrando…" ou num
 * erro: aí ele espera aqui também.
 */
import { create } from "zustand";
import type { Session } from "@/features/identity";
import { openingLink } from "@/lib/tauri/deep-link";
import { entryDestination } from "../model/destination";
import { type InviteLink, parseInviteLink } from "../model/inviteLink";

interface PendingLinkState {
	/** Já se sabe se o app abriu por um link (o `getCurrent` do plugin respondeu). */
	ready: boolean;
	/** O convite do link, até alguém usá-lo. */
	pending: InviteLink | null;
}

/** Exportado para os testes prepararem um estado. */
export const usePendingLinkStore = create<PendingLinkState>()(() => ({
	ready: false,
	pending: null,
}));

/** Se a abertura já sabe se veio um link. Até lá, ela fica em "Entrando…". */
export function useOpeningLinkReady(): boolean {
	return usePendingLinkStore((state) => state.ready);
}

let loading: Promise<void> | null = null;

/**
 * Lê o link que abriu o app, uma vez por abertura (o plugin continua devolvendo o mesmo link
 * depois). Um link que não é convite conta como nenhum, e uma falha do plugin também: o app abre
 * como se tivesse vindo pelo menu Iniciar.
 */
export function loadOpeningLink(): Promise<void> {
	loading ??= openingLink()
		.catch(() => null)
		.then((url) => {
			const link = url === null ? null : parseInviteLink(url);
			// Um link que chegou enquanto lia vale mais que o da abertura.
			usePendingLinkStore.setState((state) => ({
				ready: true,
				pending: state.pending ?? link,
			}));
		});
	return loading;
}

/** Guarda um link que chegou com a abertura em andamento. */
export function keepPendingLink(link: InviteLink): void {
	usePendingLinkStore.setState({ pending: link });
}

/**
 * Para onde a abertura vai agora, ou `null` se ainda não dá para saber. Se o caminho usa o link
 * guardado, ele sai daqui: o código já vai no endereço da tela.
 */
export function nextEntryPath(session: Session): string | null {
	const { ready, pending } = usePendingLinkStore.getState();
	if (!ready) return null;
	const path = entryDestination(session, pending);
	if (path !== null && pending !== null) {
		usePendingLinkStore.setState({ pending: null });
	}
	return path;
}
