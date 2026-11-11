/**
 * O cache da API para as conversas privadas (TanStack Query): a lista de conversas. O histórico de
 * cada uma é o mesmo cache do chat (`chatKeys.messages(id)`), porque para a API uma conversa é um
 * canal com mensagens.
 */
import {
	type QueryClient,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import { useSession } from "@/features/identity";
import { seedMissing, useUnreadTotal } from "@/features/unread";
import { type Conversation, listDms, type Message, openDm } from "@/lib/api";
import { useRealtimeOpen } from "@/lib/realtime";
import { useAppVisible } from "@/lib/visibility";
import { showDm } from "./stores/openDmsStore";

export const dmsKeys = {
	all: ["dms"] as const,
	list: () => [...dmsKeys.all, "list"] as const,
};

/** De quanto em quanto tempo a lista pergunta de novo, com o tempo real fora. */
export const DMS_REFRESH_MS = 30_000;

/**
 * As conversas de quem está usando. A API só lista as que têm mensagem; a recém-aberta e ainda
 * vazia só existe aqui, posta pelo `useOpenDm`. Por isso buscar de novo não joga fora as vazias que
 * estavam no cache: a janela dela pode estar aberta.
 */
export function useDms() {
	const queryClient = useQueryClient();
	const connected = useSession().status === "connected";
	const visible = useAppVisible();
	const live = useRealtimeOpen();
	return useQuery({
		queryKey: dmsKeys.list(),
		queryFn: async () => {
			const fresh = await listDms();
			// As não lidas de uma conversa que o `ready` ainda não trouxe (uma nova).
			seedMissing(
				fresh.map((c) => ({
					channel_id: c.id,
					last_message_id: c.last_message?.id ?? null,
					state: c.state,
				})),
			);
			const known = new Set(fresh.map((c) => c.id));
			const empty = (
				queryClient.getQueryData<Conversation[]>(dmsKeys.list()) ?? []
			).filter((c) => c.last_message === null && !known.has(c.id));
			return [...fresh, ...empty];
		},
		enabled: connected,
		// O tempo real mantém a lista em dia (`realtime.ts`).
		staleTime: Number.POSITIVE_INFINITY,
		refetchInterval: visible && !live ? DMS_REFRESH_MS : false,
	});
}

/** A soma das não lidas das conversas: o número dourado da aba Conversas e da faixa. */
export function useDmsUnread(): number {
	const { data } = useDms();
	const ids = data?.map((c) => c.id) ?? NO_IDS;
	return useUnreadTotal(ids);
}

const NO_IDS: string[] = [];

/** Põe a conversa na lista em cache, no lugar da que tinha o mesmo id. */
export function upsertConversation(
	queryClient: QueryClient,
	conversation: Conversation,
): void {
	queryClient.setQueryData<Conversation[]>(dmsKeys.list(), (list) => [
		conversation,
		...(list ?? []).filter((c) => c.id !== conversation.id),
	]);
}

/**
 * Uma mensagem nova: se é de uma conversa da lista, vira a última dela. `false` se a conversa não
 * é conhecida (ou a lista ainda não chegou).
 */
export function touchConversation(
	queryClient: QueryClient,
	message: Message,
): boolean {
	const list = queryClient.getQueryData<Conversation[]>(dmsKeys.list());
	if (!list?.some((c) => c.id === message.channel_id)) return false;
	queryClient.setQueryData<Conversation[]>(dmsKeys.list(), (current) =>
		current?.map((c) =>
			c.id === message.channel_id &&
			(c.last_message === null || c.last_message.id < message.id)
				? { ...c, last_message: message }
				: c,
		),
	);
	return true;
}

/**
 * Abre a janela da conversa com `userId`, criando a conversa na API se ainda não existe. Rejeita
 * com o erro da API (a pessoa saiu do grupo, sem rede): quem chama mostra.
 */
export function useOpenDm() {
	const queryClient = useQueryClient();
	return useCallback(
		async (userId: string) => {
			const known = queryClient
				.getQueryData<Conversation[]>(dmsKeys.list())
				?.find((c) => c.person.id === userId);
			if (known) {
				showDm(known.id);
				return;
			}
			const conversation = await openDm({ user_id: userId });
			upsertConversation(queryClient, conversation);
			showDm(conversation.id);
		},
		[queryClient],
	);
}
