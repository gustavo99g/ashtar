/**
 * O modo Organizar (ADR 0020): enquanto está ligado, a coluna mostra uma cópia da árvore, e arrastar
 * mexe só nela. O Concluir manda a cópia num `PUT /api/channels/layout` só; o Desfazer joga fora.
 *
 * Fica na memória: fechar o app no meio descarta o que não foi concluído.
 */
import { create } from "zustand";
import type { Layout } from "@/lib/api";
import { applyDrop, sameOrder } from "../model/tree";

interface OrganizeState {
	/** A árvore como estava ao abrir o modo (ou depois de um 409). `null` com o modo desligado. */
	base: Layout | null;
	/** A cópia que está sendo arrumada. Leva a versão da `base`. */
	draft: Layout | null;
}

export const useOrganize = create<OrganizeState>()(() => ({
	base: null,
	draft: null,
}));

/** Abre o modo com a árvore de agora. */
export function startOrganizing(layout: Layout): void {
	useOrganize.setState({ base: layout, draft: layout });
}

/** Sai do modo e joga a cópia fora. */
export function stopOrganizing(): void {
	useOrganize.setState({ base: null, draft: null });
}

/** Uma soltura: arruma a cópia. Soltar onde não muda nada não faz nada. */
export function dropInDraft(active: string, over: string): void {
	const { draft } = useOrganize.getState();
	if (!draft) return;
	const next = applyDrop(draft, active, over);
	if (next && !sameOrder(draft, next)) useOrganize.setState({ draft: next });
}

/** Se a cópia já tem uma ordem diferente da que o modo abriu. */
export function organizeChanged(state: OrganizeState): boolean {
	return (
		state.base !== null &&
		state.draft !== null &&
		!sameOrder(state.base, state.draft)
	);
}

/** Se o modo Organizar está ligado. */
export function useIsOrganizing(): boolean {
	return useOrganize((state) => state.draft !== null);
}
