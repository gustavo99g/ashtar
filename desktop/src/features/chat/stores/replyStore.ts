/**
 * A resposta que está sendo escrita em cada canal (ADR 0032): a mensagem respondida e se o `@` está
 * ligado (por padrão, sim). Como o rascunho, é por canal: trocar de canal e voltar mantém a faixa
 * "Respondendo a…". Só na memória.
 */
import { create } from "zustand";
import type { Message } from "@/lib/api";

export interface ReplyDraft {
	message: Message;
	mention: boolean;
}

interface ReplyState {
	byChannel: Record<string, ReplyDraft | undefined>;
}

export const useReplyStore = create<ReplyState>()(() => ({ byChannel: {} }));

export function useReply(channelId: string): ReplyDraft | undefined {
	return useReplyStore((state) => state.byChannel[channelId]);
}

export function startReply(message: Message): void {
	useReplyStore.setState((state) => ({
		byChannel: {
			...state.byChannel,
			[message.channel_id]: { message, mention: true },
		},
	}));
}

export function toggleReplyMention(channelId: string): void {
	useReplyStore.setState((state) => {
		const current = state.byChannel[channelId];
		if (!current) return state;
		return {
			byChannel: {
				...state.byChannel,
				[channelId]: { ...current, mention: !current.mention },
			},
		};
	});
}

export function cancelReply(channelId: string): void {
	useReplyStore.setState((state) => ({
		byChannel: { ...state.byChannel, [channelId]: undefined },
	}));
}

/** A original foi excluída: a resposta que se escrevia a ela perde a citação. */
export function forgetReplyTo(channelId: string, messageId: string): void {
	if (useReplyStore.getState().byChannel[channelId]?.message.id === messageId) {
		cancelReply(channelId);
	}
}
