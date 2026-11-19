/**
 * As não lidas de quem está usando (ADR 0022): por canal de texto e por conversa, o ponteiro, as
 * não lidas, as menções e o silenciar, como a API manda (`ReadState`).
 *
 * Quem enche: o `ready` do tempo real (todos de uma vez, a cada conexão), o `GET /api/dms` (só as
 * conversas que este cache ainda não conhece) e o `channel.state` (o estado de um, depois de marcar
 * ou silenciar, aqui ou noutro computador). Entre um e outro, cada `message.created` de outra pessoa
 * soma um, e a sua própria leva o ponteiro até ela, como a API faz.
 *
 * Não fica no disco: o `ready` traz tudo de novo a cada conexão.
 */
import { create } from "zustand";
import {
	type ChannelHead,
	markAllRead as apiMarkAllRead,
	markRead as apiMarkRead,
	type Message,
	type ReadState,
	setMuted as apiSetMuted,
} from "@/lib/api";

/** O teto das contagens, o mesmo da API: acima disso aparece "99+". */
export const UNREAD_CAP = 100;

export const EMPTY_STATE: ReadState = {
	last_read_id: null,
	unread: 0,
	mentions: 0,
	muted: false,
};

interface UnreadStore {
	/** O id de quem está usando, do `ready`: a mensagem dele não conta. */
	me: string | null;
	byChannel: Record<string, ReadState>;
	/**
	 * A mensagem mais nova já contada de cada canal. Uma mensagem que chega duas vezes (o envio e o
	 * evento, ou o reencontro depois de uma queda) não conta duas.
	 */
	newest: Record<string, string>;
}

const INITIAL: UnreadStore = { me: null, byChannel: {}, newest: {} };

export const useUnreadStore = create<UnreadStore>()(() => INITIAL);

type Head = Pick<ChannelHead, "channel_id" | "last_message_id">;

function newestOf(heads: Head[]): Record<string, string> {
	const newest: Record<string, string> = {};
	for (const head of heads) {
		if (head.last_message_id) newest[head.channel_id] = head.last_message_id;
	}
	return newest;
}

/** O `ready`: troca tudo pelo que a API mandou. */
export function seedFromReady(me: string, heads: ChannelHead[]): void {
	useUnreadStore.setState({
		me,
		byChannel: Object.fromEntries(heads.map((h) => [h.channel_id, h.state])),
		newest: newestOf(heads),
	});
}

/**
 * Estados vindos de uma lista (o `GET /api/dms`). Só entram os de canais ainda desconhecidos: os
 * conhecidos já estão em dia pelo tempo real, e a lista pode ter saído antes de um evento.
 */
export function seedMissing(entries: (Head & { state: ReadState })[]): void {
	useUnreadStore.setState((store) => {
		const missing = entries.filter((e) => !(e.channel_id in store.byChannel));
		if (missing.length === 0) return store;
		return {
			byChannel: {
				...store.byChannel,
				...Object.fromEntries(missing.map((e) => [e.channel_id, e.state])),
			},
			newest: { ...store.newest, ...newestOf(missing) },
		};
	});
}

/** O `channel.state`: o estado de um canal, como está na API agora. */
export function applyState(channelId: string, state: ReadState): void {
	useUnreadStore.setState((store) => ({
		byChannel: { ...store.byChannel, [channelId]: state },
	}));
}

/** Uma mensagem nova chegou num canal ou conversa. */
export function countMessage(message: Message): void {
	useUnreadStore.setState((store) => {
		const id = message.channel_id;
		const known = store.newest[id];
		if (known && message.id <= known) return store;
		const current = store.byChannel[id] ?? EMPTY_STATE;
		const mine = message.author.id === store.me;
		// Do registro de ligação (ADR 0023), só a chamada perdida conta, como na API.
		const counts =
			message.kind !== "call" || message.call?.outcome === "missed";
		const next: ReadState = mine
			? { ...current, last_read_id: message.id, unread: 0, mentions: 0 }
			: !counts
				? current
				: {
						...current,
						unread: Math.min(UNREAD_CAP, current.unread + 1),
						mentions:
							store.me && message.mentions.includes(store.me)
								? Math.min(UNREAD_CAP, current.mentions + 1)
								: current.mentions,
					};
		return {
			byChannel: { ...store.byChannel, [id]: next },
			newest: { ...store.newest, [id]: message.id },
		};
	});
}

/**
 * Dá o canal como lido até `messageId`: zera aqui na hora e avisa a API. A resposta (e o
 * `channel.state` que vem junto) acerta o que tiver chegado no meio. Se falhar, a próxima mensagem
 * vista tenta de novo.
 */
export async function markChannelRead(
	channelId: string,
	messageId: string,
): Promise<void> {
	const current = useUnreadStore.getState().byChannel[channelId] ?? EMPTY_STATE;
	if (current.last_read_id && messageId <= current.last_read_id) return;
	applyState(channelId, {
		...current,
		last_read_id: messageId,
		unread: 0,
		mentions: 0,
	});
	try {
		applyState(channelId, await apiMarkRead(channelId, { message_id: messageId }));
	} catch {
		// Fica zerado aqui; o ponteiro na API anda na próxima vez.
	}
}

/**
 * Silencia ou volta a ouvir (Etapa 14): muda aqui na hora e avisa a API. Se a API recusar, volta
 * como estava e rejeita, para quem chamou mostrar.
 */
export async function setChannelMuted(
	channelId: string,
	muted: boolean,
): Promise<void> {
	const before = useUnreadStore.getState().byChannel[channelId] ?? EMPTY_STATE;
	applyState(channelId, { ...before, muted });
	try {
		applyState(channelId, await apiSetMuted(channelId, { muted }));
	} catch (error) {
		const now = useUnreadStore.getState().byChannel[channelId] ?? EMPTY_STATE;
		applyState(channelId, { ...now, muted: before.muted });
		throw error;
	}
}

/**
 * O número que aparece para um canal ou conversa: as não lidas, ou, silenciado, só as menções (a
 * menção passa por cima do silenciar).
 */
export function shownCount(state: ReadState): number {
	return state.muted ? state.mentions : state.unread;
}

/** O "Marcar tudo como lido": zera tudo aqui e pede à API. */
export async function markEverythingRead(): Promise<void> {
	useUnreadStore.setState((store) => ({
		byChannel: Object.fromEntries(
			Object.entries(store.byChannel).map(([id, state]) => [
				id,
				{
					...state,
					last_read_id: store.newest[id] ?? state.last_read_id,
					unread: 0,
					mentions: 0,
				},
			]),
		),
	}));
	await apiMarkAllRead();
}

/** Sair da conta. */
export function clearUnread(): void {
	useUnreadStore.setState(INITIAL);
}

/** O estado de um canal, ou o vazio enquanto não chegou. */
export function useReadState(channelId: string): ReadState {
	return useUnreadStore((store) => store.byChannel[channelId] ?? EMPTY_STATE);
}

/**
 * A soma do que aparece destes canais (o número da aba Conversas): as não lidas, e só as menções
 * dos silenciados.
 */
export function useUnreadTotal(channelIds: readonly string[]): number {
	return useUnreadStore((store) =>
		channelIds.reduce(
			(sum, id) => sum + shownCount(store.byChannel[id] ?? EMPTY_STATE),
			0,
		),
	);
}
