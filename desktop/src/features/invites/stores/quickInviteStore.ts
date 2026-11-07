/**
 * O convite rápido da sala (o Convidar): um "Para o grupo" criado na primeira vez e guardado na
 * memória enquanto vale, para abrir de novo mostrar o mesmo. Só na memória: o código não aparece
 * de novo pela API, e fechar o app esquece.
 */
import { create } from "zustand";
import type { CreatedInviteView } from "@/lib/api";

/** Faltando menos que isto, cria outro: não daria tempo de mandar e alguém clicar. */
export const QUICK_INVITE_MARGIN_MS = 30_000;

export interface QuickInvite {
	invite: CreatedInviteView;
	/** Quando a resposta chegou (`Date.now()`), para a barra do tempo que resta. */
	receivedAt: number;
}

export const useQuickInviteStore = create<{ current: QuickInvite | null }>()(
	() => ({
		current: null,
	}),
);

export function rememberQuickInvite(
	invite: CreatedInviteView,
	now = Date.now(),
): void {
	useQuickInviteStore.setState({ current: { invite, receivedAt: now } });
}

/** Esquece o convite rápido; com `id`, só se for ele (o Painel chama ao revogar um convite). */
export function forgetQuickInvite(id?: string): void {
	const { current } = useQuickInviteStore.getState();
	if (id === undefined || current?.invite.id === id) {
		useQuickInviteStore.setState({ current: null });
	}
}

/** Ainda serve para mandar: falta mais que a margem para vencer. */
export function isStillValid(invite: CreatedInviteView, now: number): boolean {
	return invite.expires_at * 1000 - now > QUICK_INVITE_MARGIN_MS;
}

/** O que resta do prazo, de 0 a 1, contado de quando o convite chegou. */
export function timeLeft(
	{ invite, receivedAt }: QuickInvite,
	now: number,
): number {
	const end = invite.expires_at * 1000;
	const total = end - receivedAt;
	if (total <= 0) return 0;
	return Math.min(1, Math.max(0, (end - now) / total));
}
