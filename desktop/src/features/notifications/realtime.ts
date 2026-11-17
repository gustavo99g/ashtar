/**
 * Os eventos do tempo real que viram aviso (Etapa 15). Roda na janela principal: decide pela regra
 * (`model/decide.ts`) e manda o cartão para a janela dos avisos, pelo Rust.
 *
 * - `message.created` de outra pessoa: numa conversa privada, ou num canal quando menciona quem
 *   está usando.
 * - `voice.participants`: alguém passou a transmitir. A primeira lista de cada sala só serve de
 *   base (quem já transmitia antes de o app abrir não vira aviso).
 */
import type { QueryClient } from "@tanstack/react-query";
import { channelsKeys, findChannel } from "@/features/channels";
import { useSettingsStore } from "@/features/settings";
import { EMPTY_STATE, useUnreadStore } from "@/features/unread";
import type { Layout, Message, ParticipantView, ServerEvent } from "@/lib/api";
import { notificationShow } from "@/lib/tauri/commands";
import { type CardInput, cardKey, type CardTarget, shortBody } from "./model/cards";
import { decide, type NotifyEvent } from "./model/decide";
import { isViewing, useNotificationContext } from "./stores/contextStore";

/** Quem transmitia em cada sala, no último `voice.participants`. */
let sharing = new Map<string, Set<string>>();

/** Para os testes, e ao sair da conta. */
export function resetStreamWatch(): void {
	sharing = new Map();
}

export function handleNotificationsRealtime(
	event: ServerEvent,
	queryClient: QueryClient,
): void {
	switch (event.type) {
		case "message.created":
			onMessage(event.message, queryClient);
			break;
		case "voice.participants":
			onParticipants(event.channel_id, event.participants, queryClient);
			break;
	}
}

function show(card: CardInput): void {
	void notificationShow(card).catch(() => {});
}

function onMessage(message: Message, queryClient: QueryClient): void {
	const me = useUnreadStore.getState().me;
	if (!me || message.author.id === me) return;
	const layout = queryClient.getQueryData<Layout>(channelsKeys.layout());
	// Sem a lista de canais, não dá para saber se é conversa ou canal: melhor não avisar errado.
	if (!layout) return;
	const channel = findChannel(layout, message.channel_id);
	const mentioned = message.mentions.includes(me);
	const event: NotifyEvent = channel
		? { kind: "channel", mentioned }
		: { kind: "dm", mentioned };
	const context = useNotificationContext.getState();
	const state =
		useUnreadStore.getState().byChannel[message.channel_id] ?? EMPTY_STATE;
	const decision = decide({
		event,
		status: context.status,
		muted: state.muted,
		viewing: isViewing(context, message.channel_id),
		prefs: useSettingsStore.getState().notifications,
	});
	if (!decision.show) return;

	const target: CardTarget = channel
		? { kind: "channel", channelId: message.channel_id }
		: { kind: "dm", channelId: message.channel_id };
	const { author } = message;
	show({
		key: cardKey(target),
		kind: target.kind,
		person: { nick: author.nick, displayName: author.display_name },
		title: author.display_name ?? author.nick,
		context: channel ? `#${channel.name}` : "Mensagem privada",
		body: shortBody(message.body),
		sound: decision.sound,
		target,
	});
}

function onParticipants(
	channelId: string,
	participants: ParticipantView[],
	queryClient: QueryClient,
): void {
	const before = sharing.get(channelId);
	const now = new Set(
		participants.filter((p) => p.screen_sharing).map((p) => p.user_id),
	);
	sharing.set(channelId, now);
	if (!before) return;

	const me = useUnreadStore.getState().me;
	const context = useNotificationContext.getState();
	const started = participants.filter(
		(p) => p.screen_sharing && !before.has(p.user_id) && p.user_id !== me,
	);
	if (started.length === 0) return;
	const decision = decide({
		event: { kind: "stream" },
		status: context.status,
		muted: false,
		viewing: context.voiceChannelId === channelId,
		prefs: useSettingsStore.getState().notifications,
	});
	if (!decision.show) return;

	const layout = queryClient.getQueryData<Layout>(channelsKeys.layout());
	const room = layout && findChannel(layout, channelId);
	for (const person of started) {
		const target: CardTarget = {
			kind: "stream",
			channelId,
			userId: person.user_id,
		};
		show({
			key: cardKey(target),
			kind: "stream",
			person: { nick: person.nick, displayName: person.display_name },
			title: person.display_name ?? person.nick,
			context: room?.name ?? "Sala",
			body: "começou a transmitir",
			sound: null,
			target,
		});
	}
}
