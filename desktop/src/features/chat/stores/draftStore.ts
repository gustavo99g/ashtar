/**
 * O rascunho de cada canal: o que estava escrito e não foi mandado. Trocar de canal, ir para a
 * sala ou fechar o app não perde o texto. Fica no `localStorage`, por computador.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface DraftState {
	drafts: Record<string, string>;
}

export const useDrafts = create<DraftState>()(
	persist(() => ({ drafts: {} }), {
		name: "ashtar-chat-drafts",
		version: 1,
	}),
);

export function useDraft(channelId: string): string {
	return useDrafts((state) => state.drafts[channelId] ?? "");
}

/** Grava o rascunho; texto só de espaços some. */
export function setDraft(channelId: string, text: string): void {
	useDrafts.setState((state) => {
		const drafts = { ...state.drafts };
		if (text.trim().length === 0) delete drafts[channelId];
		else drafts[channelId] = text;
		return { drafts };
	});
}
