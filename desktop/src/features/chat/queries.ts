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
import { rememberAvatars, useSession } from "@/features/identity";
import {
	ApiError,
	type ChannelHead,
	deleteMessage,
	editMessage,
	listMessages,
	listPeople,
	listPins,
	type Message,
	type MessagePage,
	type Person,
	sendMessage,
	setPinned,
	setReaction,
	uploadFile,
} from "@/lib/api";
import { useRealtimeOpen } from "@/lib/realtime";
import { useAppVisible } from "@/lib/visibility";
import { makeThumbnail, makeVideoCover } from "./model/attachments";
import type { DraftFile } from "./stores/attachmentStore";
import {
	addPending,
	findPending,
	type PendingFile,
	type PendingReply,
	removePending,
	updatePending,
	updatePendingFile,
} from "./stores/outboxStore";

export const chatKeys = {
	all: ["chat"] as const,
	messages: (channelId: string) =>
		[...chatKeys.all, "messages", channelId] as const,
	people: () => [...chatKeys.all, "people"] as const,
	/** O histórico aberto em volta de uma mensagem antiga (a citação, a busca, as fixadas). */
	around: (channelId: string, anchor: string) =>
		[...chatKeys.all, "around", channelId, anchor] as const,
	pins: (channelId: string) => [...chatKeys.all, "pins", channelId] as const,
};

/** As fixadas do canal (`GET /api/channels/{id}/pins`); o tempo real mantém em dia (`syncPin`). */
export function usePins(channelId: string) {
	const connected = useSession().status === "connected";
	return useQuery({
		queryKey: chatKeys.pins(channelId),
		queryFn: () => listPins(channelId),
		enabled: connected,
		staleTime: Number.POSITIVE_INFINITY,
	});
}

/**
 * Põe a mensagem mudada na lista das fixadas: entra se foi fixada, sai se foi desafixada ou
 * excluída (`null`), e a que continua fixada fica com o texto novo.
 */
export function syncPin(
	queryClient: QueryClient,
	channelId: string,
	messageId: string,
	message: Message | null,
): void {
	queryClient.setQueryData<Message[]>(chatKeys.pins(channelId), (pins) => {
		if (!pins) return pins;
		const rest = pins.filter((pin) => pin.id !== messageId);
		if (!message?.pinned_at) {
			return rest.length === pins.length ? pins : rest;
		}
		return [...rest, message].sort(
			(a, b) => (b.pinned_at ?? 0) - (a.pinned_at ?? 0),
		);
	});
}

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

/** Uma página do histórico em volta de uma mensagem: o cursor diz para que lado ela foi buscada. */
type AroundParam = { around: string } | { before: string } | { after: string };

/**
 * O histórico em volta de `anchor` (ADR 0032): a primeira página vem do `?around=`, e dali rola para
 * os dois lados (`before` no topo, `after` no fim). Fica numa chave separada do histórico de
 * sempre, que continua recebendo as novas pelo tempo real; "Ir para o presente" só volta para ele.
 */
export function useAroundMessages(channelId: string, anchor: string | null) {
	const connected = useSession().status === "connected";
	const query = useInfiniteQuery({
		queryKey: chatKeys.around(channelId, anchor ?? ""),
		queryFn: ({ pageParam }) => listMessages(channelId, pageParam),
		initialPageParam: { around: anchor ?? "" } as AroundParam,
		getPreviousPageParam: (first) =>
			first.has_more && first.messages[0]
				? ({ before: first.messages[0].id } as AroundParam)
				: null,
		getNextPageParam: (last) => {
			// A do `around` diz no `has_newer`; as do `after`, no `has_more`.
			const newer = last.has_newer ?? last.has_more;
			const newest = last.messages[last.messages.length - 1];
			return newer && newest ? ({ after: newest.id } as AroundParam) : null;
		},
		enabled: connected && anchor !== null,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: 0,
	});
	const messages = query.data?.pages.flatMap((page) => page.messages);
	return { ...query, messages };
}

/**
 * Muda as mensagens de `channelId` em todo histórico em cache (o de sempre e os abertos em volta
 * de uma mensagem).
 */
function changeHistories(
	queryClient: QueryClient,
	channelId: string,
	change: (message: Message) => Message | null,
): void {
	const update = (data: MessagePages | undefined) => {
		if (!data) return data;
		let changed = false;
		const pages = data.pages.map((page) => {
			const messages: Message[] = [];
			for (const message of page.messages) {
				const next = change(message);
				if (next !== message) changed = true;
				if (next) messages.push(next);
			}
			return changed ? { ...page, messages } : page;
		});
		return changed ? { ...data, pages } : data;
	};
	queryClient.setQueriesData<MessagePages>(
		{ queryKey: chatKeys.messages(channelId) },
		update,
	);
	queryClient.setQueriesData<MessagePages>(
		{ queryKey: [...chatKeys.all, "around", channelId] },
		update,
	);
}

/** O começo do texto que a citação da resposta mostra (o mesmo corte da API). */
export function replyExcerpt(body: string): string {
	const line = body.split(/\s+/).filter(Boolean).join(" ");
	const chars = [...line];
	return chars.length > 120 ? `${chars.slice(0, 120).join("")}…` : line;
}

/**
 * A mensagem mudou (`message.updated`, ou a resposta de editar ou reagir): troca no cache, e as
 * respostas a ela passam a citar o texto novo.
 */
export function replaceMessage(queryClient: QueryClient, updated: Message): void {
	syncPin(queryClient, updated.channel_id, updated.id, updated);
	changeHistories(queryClient, updated.channel_id, (message) => {
		if (message.id === updated.id) return updated;
		if (message.reply_to?.id === updated.id && message.reply_to.author) {
			return {
				...message,
				reply_to: { ...message.reply_to, excerpt: replyExcerpt(updated.body) },
			};
		}
		return message;
	});
}

/**
 * A mensagem foi excluída (`message.deleted`): sai do cache, e as respostas a ela passam a mostrar
 * "Mensagem original excluída".
 */
export function dropMessage(
	queryClient: QueryClient,
	channelId: string,
	messageId: string,
): void {
	syncPin(queryClient, channelId, messageId, null);
	changeHistories(queryClient, channelId, (message) => {
		if (message.id === messageId) return null;
		if (message.reply_to?.id === messageId && message.reply_to.author) {
			return {
				...message,
				reply_to: { id: messageId, author: null, excerpt: null },
			};
		}
		return message;
	});
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

/**
 * Sobe um anexo da caixa de saída: a miniatura (de uma imagem) ou a capa (de um vídeo) antes, se
 * abre aqui, depois o arquivo, com as dimensões e a duração. Devolve o id e guarda na mensagem,
 * para o "Tentar de novo" não subir de novo.
 */
async function uploadAttachment(
	clientId: string,
	pending: PendingFile,
): Promise<string> {
	const { file, key } = pending;
	const thumbnail = (await makeThumbnail(file)) ?? (await makeVideoCover(file));
	const thumb = thumbnail
		? await uploadFile(thumbnail.blob, {
				kind: "attachment",
				name: "capa.webp",
			})
		: null;
	const uploaded = await uploadFile(file, {
		kind: "attachment",
		name: file.name || "arquivo",
		width: thumbnail?.width,
		height: thumbnail?.height,
		durationMs: thumbnail?.durationMs,
		thumbnail: thumb?.id,
		onProgress: (progress) =>
			updatePendingFile(clientId, key, { progress }),
	});
	updatePendingFile(clientId, key, { progress: 1, uploaded: uploaded.id });
	return uploaded.id;
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
		const attachments: string[] = [];
		for (const file of pending.files ?? []) {
			attachments.push(file.uploaded ?? (await uploadAttachment(clientId, file)));
		}
		const message = await sendMessage(pending.channel_id, {
			client_id: clientId,
			body: pending.body,
			reply_to: pending.reply?.id,
			reply_mention: pending.reply?.mention,
			...(attachments.length > 0 ? { attachments } : {}),
			...(pending.forward ? { forward: pending.forward } : {}),
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
		(
			channelId: string,
			body: string,
			reply?: PendingReply,
			files: readonly DraftFile[] = [],
		) => {
			const clientId = newClientId();
			addPending({
				client_id: clientId,
				channel_id: channelId,
				body: body.trim(),
				reply,
				...(files.length > 0
					? {
							files: files.map(({ key, file }) => ({
								key,
								file,
								progress: 0,
							})),
						}
					: {}),
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
	/** Encaminha `original` para `channelId` (aparece na hora, como um envio). */
	const forward = useCallback(
		(channelId: string, original: Message) => {
			const clientId = newClientId();
			addPending({
				client_id: clientId,
				channel_id: channelId,
				body: original.body,
				forward: original.id,
				created_at: Math.floor(Date.now() / 1000),
				status: "sending",
			});
			void deliver(queryClient, clientId);
		},
		[queryClient],
	);
	return { send, retry, discard: removePending, forward };
}

/**
 * Editar, excluir e reagir (ADR 0032). Cada um já põe a resposta no cache, sem esperar o
 * `message.updated` ou o `message.deleted` (que chegam também, e não mudam nada de novo).
 */
export function useMessageActions() {
	const queryClient = useQueryClient();
	const edit = useCallback(
		async (message: Message, body: string) => {
			replaceMessage(queryClient, await editMessage(message.id, { body: body.trim() }));
		},
		[queryClient],
	);
	const remove = useCallback(
		async (message: Message) => {
			await deleteMessage(message.id);
			dropMessage(queryClient, message.channel_id, message.id);
		},
		[queryClient],
	);
	const react = useCallback(
		async (message: Message, emoji: string, on: boolean) => {
			replaceMessage(queryClient, await setReaction(message.id, emoji, on));
		},
		[queryClient],
	);
	const pin = useCallback(
		async (message: Message, on: boolean) => {
			replaceMessage(queryClient, await setPinned(message.id, on));
		},
		[queryClient],
	);
	return { edit, remove, react, pin };
}

/** A lista de pessoas, guardando a foto de cada uma para o `Avatar`. */
async function fetchPeople(): Promise<Person[]> {
	const people = await listPeople();
	rememberAvatars(people);
	return people;
}

/**
 * A foto ou o nome novo de alguém (`user.updated`) nas mensagens em cache, que trazem o autor
 * inteiro.
 */
export function updateAuthor(
	queryClient: QueryClient,
	userId: string,
	change: Pick<Message["author"], "display_name" | "avatar">,
): void {
	for (const kind of ["messages", "around"]) {
		queryClient.setQueriesData<MessagePages>(
			{ queryKey: [...chatKeys.all, kind] },
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
								? { ...message, author: { ...message.author, ...change } }
								: message,
						),
					};
				});
				return changed ? { ...data, pages } : data;
			},
		);
	}
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
		queryFn: fetchPeople,
		enabled: connected,
		staleTime: Number.POSITIVE_INFINITY,
		refetchInterval: visible && !live ? PEOPLE_REFRESH_MS : false,
	});
}
