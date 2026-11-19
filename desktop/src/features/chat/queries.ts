/**
 * O cache da API para o chat (TanStack Query): o histórico de cada canal, o envio e quem está no
 * grupo. Os eventos do tempo real (`realtime.ts`) escrevem nas mesmas chaves.
 *
 * O histórico é uma consulta infinita "para trás": a primeira página são as 50 mais recentes, e
 * rolar até o topo busca a página anterior (`before`). As novas não vêm por página: chegam pelo
 * `message.created` e entram no fim da última (`appendMessages`).
 *
 * **O histórico nunca é invalidado, só recomeçado (`resetQueries`).** Ao recarregar uma consulta
 * infinita, o TanStack busca de novo a primeira página guardada (a mais antiga, pelo `before`) e
 * pede as seguintes ao `getNextPageParam`, que aqui não existe: depois de rolar para cima, um
 * `invalidateQueries` deixaria só a página mais velha, e as recentes sumiriam.
 */
import {
	type InfiniteData,
	type QueryClient,
	useInfiniteQuery,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useSession } from "@/features/identity";
import {
	ApiError,
	type ChannelHead,
	listMessages,
	listPeople,
	type Message,
	type MessagePage,
	sendMessage,
} from "@/lib/api";
import { useRealtimeOpen } from "@/lib/realtime";
import { useAppVisible } from "@/lib/visibility";
import {
	addPending,
	findPending,
	removePending,
	updatePending,
} from "./stores/outboxStore";

export const chatKeys = {
	all: ["chat"] as const,
	messages: (channelId: string) =>
		[...chatKeys.all, "messages", channelId] as const,
	people: () => [...chatKeys.all, "people"] as const,
};

export type MessagePages = InfiniteData<MessagePage, string | null>;

/** O histórico do canal, da mais antiga para a mais nova, juntando as páginas. */
export function useMessages(channelId: string) {
	const connected = useSession().status === "connected";
	const query = useInfiniteQuery({
		queryKey: chatKeys.messages(channelId),
		queryFn: ({ pageParam }) =>
			listMessages(channelId, pageParam ? { before: pageParam } : {}),
		initialPageParam: null as string | null,
		getPreviousPageParam: (first) =>
			first.has_more ? (first.messages[0]?.id ?? null) : null,
		getNextPageParam: () => null,
		enabled: connected,
		// O tempo real mantém o histórico em dia; com ele fora, o `ready` da volta busca o que faltou.
		staleTime: Number.POSITIVE_INFINITY,
	});
	const messages = query.data?.pages.flatMap((page) => page.messages);
	return { ...query, messages };
}

/**
 * Põe mensagens no fim do histórico em cache, sem repetir as que já estão. Sem o canal no cache
 * (ninguém abriu ainda), não faz nada: ao abrir, a primeira página já vem com elas.
 */
export function appendMessages(
	queryClient: QueryClient,
	channelId: string,
	incoming: Message[],
): void {
	queryClient.setQueryData<MessagePages>(
		chatKeys.messages(channelId),
		(data) => {
			if (!data || data.pages.length === 0) return data;
			const known = new Set(
				data.pages.flatMap((page) => page.messages.map((m) => m.id)),
			);
			const fresh = incoming.filter((message) => !known.has(message.id));
			if (fresh.length === 0) return data;
			const pages = [...data.pages];
			const last = pages[pages.length - 1];
			pages[pages.length - 1] = {
				...last,
				messages: [...last.messages, ...fresh].sort((a, b) =>
					a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
				),
			};
			return { ...data, pages };
		},
	);
}

/** Todos os históricos em cache. */
function cachedHistories(queryClient: QueryClient) {
	return queryClient.getQueriesData<MessagePages>({
		queryKey: [...chatKeys.all, "messages"],
	});
}

/**
 * Busca o que chegou depois da última mensagem de cada canal em cache. Mais de 200 perdidas,
 * recomeça o canal pelas mais recentes.
 *
 * Com `heads` (o `channels` do `ready`, na volta de uma queda), só pergunta nos canais que
 * andaram; canal que não está no `ready` foi arquivado e fica como está. Sem `heads` (o tempo real
 * fora, de tempos em tempos), pergunta em todos: num canal vazio, pela página mais recente.
 */
export async function catchUp(
	queryClient: QueryClient,
	heads?: Pick<ChannelHead, "channel_id" | "last_message_id">[],
): Promise<void> {
	const latest =
		heads &&
		new Map(heads.map((head) => [head.channel_id, head.last_message_id]));
	await Promise.all(
		cachedHistories(queryClient).map(async ([key, data]) => {
			const channelId = key[2] as string;
			const lastPage = data?.pages[data.pages.length - 1];
			const newest = lastPage?.messages[lastPage.messages.length - 1];
			if (latest) {
				if (!latest.has(channelId)) return;
				if ((latest.get(channelId) ?? null) === (newest?.id ?? null)) return;
			}
			try {
				if (!newest) {
					// Sem `heads`, só dá para saber se o canal vazio ganhou mensagem perguntando.
					if (!latest && (await listMessages(channelId)).messages.length === 0) {
						return;
					}
					await queryClient.resetQueries({ queryKey: key, exact: true });
					return;
				}
				const page = await listMessages(channelId, { after: newest.id });
				if (page.has_more) {
					await queryClient.resetQueries({ queryKey: key, exact: true });
				} else {
					appendMessages(queryClient, channelId, page.messages);
				}
			} catch {
				// Canal arquivado no meio, ou a rede de novo: a tela mostra o que tem.
			}
		}),
	);
}

/** De quanto em quanto tempo o histórico pergunta o que chegou, com o tempo real fora. */
export const OFFLINE_CATCH_UP_MS = 15_000;

/**
 * Com o tempo real fora (voltando, ou encerrado), o histórico não recebe nada por evento e não pode
 * ser invalidado (ver o começo do arquivo): então, de 15 em 15 segundos, enquanto o app está à
 * vista, busca o que chegou em cada canal em cache (`catchUp` sem `heads`). Fica no
 * `RealtimeBridge`, um só para o app.
 */
export function useOfflineCatchUp(): void {
	const queryClient = useQueryClient();
	const connected = useSession().status === "connected";
	const visible = useAppVisible();
	const live = useRealtimeOpen();
	useEffect(() => {
		if (!connected || !visible || live) return;
		const timer = setInterval(
			() => void catchUp(queryClient),
			OFFLINE_CATCH_UP_MS,
		);
		return () => clearInterval(timer);
	}, [connected, visible, live, queryClient]);
}

/**
 * Marca como "saiu do grupo" as mensagens já em cache de quem foi removido, para o rótulo aparecer
 * na hora, sem buscar o histórico de novo.
 */
export function markAuthorRemoved(
	queryClient: QueryClient,
	userId: string,
): void {
	queryClient.setQueriesData<MessagePages>(
		{ queryKey: [...chatKeys.all, "messages"] },
		(data) => {
			if (!data) return data;
			let changed = false;
			const pages = data.pages.map((page) => {
				if (!page.messages.some((m) => m.author.id === userId)) return page;
				changed = true;
				return {
					...page,
					messages: page.messages.map((message) =>
						message.author.id === userId
							? { ...message, author: { ...message.author, removed: true } }
							: message,
					),
				};
			});
			return changed ? { ...data, pages } : data;
		},
	);
}

function newClientId(): string {
	return crypto.randomUUID();
}

function failureMessage(error: unknown): string {
	return error instanceof ApiError
		? error.message
		: "Não foi possível mandar a mensagem.";
}

/** Manda (ou manda de novo) uma mensagem que já está na caixa de saída. */
async function deliver(
	queryClient: QueryClient,
	clientId: string,
): Promise<void> {
	const pending = findPending(clientId);
	if (!pending) return;
	updatePending(clientId, { status: "sending", error: undefined });
	try {
		const message = await sendMessage(pending.channel_id, {
			client_id: clientId,
			body: pending.body,
		});
		appendMessages(queryClient, pending.channel_id, [message]);
		removePending(clientId);
	} catch (error) {
		// O `message.created` pode ter chegado antes da falha da resposta: aí já está na conversa.
		if (findPending(clientId)) {
			updatePending(clientId, {
				status: "failed",
				error: failureMessage(error),
			});
		}
	}
}

/**
 * O envio: põe a mensagem na caixa de saída (aparece na hora) e manda. `retry` repete uma que
 * falhou, com o mesmo `client_id`; `discard` desiste dela.
 */
export function useSendMessage() {
	const queryClient = useQueryClient();
	const send = useCallback(
		(channelId: string, body: string) => {
			const clientId = newClientId();
			addPending({
				client_id: clientId,
				channel_id: channelId,
				body: body.trim(),
				created_at: Math.floor(Date.now() / 1000),
				status: "sending",
			});
			void deliver(queryClient, clientId);
		},
		[queryClient],
	);
	const retry = useCallback(
		(clientId: string) => void deliver(queryClient, clientId),
		[queryClient],
	);
	return { send, retry, discard: removePending };
}

/** De quanto em quanto tempo a coluna de membros pergunta quem está online, com o tempo real fora. */
export const PEOPLE_REFRESH_MS = 30_000;

/**
 * Quem está no grupo (`GET /api/people`), com quem está online. Com o tempo real aberto, a
 * presença chega por evento; fora dele, pergunta de 30 em 30 segundos enquanto o app está à vista,
 * para a coluna não ficar parada no que era.
 */
export function usePeople() {
	const connected = useSession().status === "connected";
	const visible = useAppVisible();
	const live = useRealtimeOpen();
	return useQuery({
		queryKey: chatKeys.people(),
		queryFn: listPeople,
		enabled: connected,
		staleTime: Number.POSITIVE_INFINITY,
		refetchInterval: visible && !live ? PEOPLE_REFRESH_MS : false,
	});
}
