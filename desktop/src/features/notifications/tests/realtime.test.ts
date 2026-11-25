import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { channelsKeys } from "@/features/channels";
import { DEFAULT_NOTIFICATIONS, useSettingsStore } from "@/features/settings";
import { clearUnread, useUnreadStore } from "@/features/unread";
import type { Layout, Message, ParticipantView, ServerEvent } from "@/lib/api";
import { handleNotificationsRealtime, resetStreamWatch } from "../realtime";
import {
	INITIAL_CONTEXT,
	setNotificationContext,
	useNotificationContext,
} from "../stores/contextStore";

const notificationShow = vi.fn<(card: unknown) => Promise<boolean>>(() =>
	Promise.resolve(true),
);

vi.mock("@/lib/tauri/commands", () => ({
	notificationShow: (card: unknown) => notificationShow(card),
}));

const layout: Layout = {
	version: 1,
	top: [
		{ id: "geral", kind: "text", name: "geral", topic: null, category_id: null, archived_at: null, restricted: false },
		{ id: "sala", kind: "voice", name: "Sala", topic: null, category_id: null, archived_at: null, restricted: false },
	],
	categories: [],
};

function message(channelId: string, mentions: string[] = [], author = "ana"): Message {
	return {
		id: `m-${Math.random()}`,
		channel_id: channelId,
		client_id: "c",
		author: { id: author, nick: author, display_name: author === "ana" ? "Ana" : null, removed: false },
		body: "oi, vai entrar na sala hoje?",
		mentions,
		created_at: 1,
		kind: "text",
		edited_at: null,
		reply_to: null,
		reactions: [],
		pinned_at: null,
		attachments: [],
		previews: [],
		forwarded: null,
		call: null,
	};
}

function participant(id: string, sharing: boolean): ParticipantView {
	return { user_id: id, nick: id, display_name: null, screen_sharing: sharing, mic_off: false, deafened: false, camera: false, server_muted: false, server_deafened: false, sounds_blocked: false };
}

let client: QueryClient;
const send = (event: ServerEvent) => handleNotificationsRealtime(event, client);
const shown = () => notificationShow.mock.calls.map(([card]) => card as Record<string, unknown>);

describe("handleNotificationsRealtime", () => {
	beforeEach(() => {
		notificationShow.mockClear();
		client = new QueryClient();
		client.setQueryData(channelsKeys.layout(), layout);
		clearUnread();
		useUnreadStore.setState({ me: "eu" });
		useNotificationContext.setState(INITIAL_CONTEXT);
		useSettingsStore.setState({ notifications: DEFAULT_NOTIFICATIONS });
		resetStreamWatch();
	});

	it("uma mensagem privada vira um cartão com o nome, o começo do texto e o som", () => {
		send({ type: "message.created", message: message("d1") });
		expect(shown()).toEqual([
			expect.objectContaining({
				key: "dm:d1",
				title: "Ana",
				context: "Mensagem privada",
				body: "oi, vai entrar na sala hoje?",
				sound: "dm",
				target: { kind: "dm", channelId: "d1" },
			}),
		]);
	});

	it("mensagem de canal só avisa com menção, e o cartão diz o canal", () => {
		send({ type: "message.created", message: message("geral") });
		expect(shown()).toEqual([]);
		send({ type: "message.created", message: message("geral", ["eu"]) });
		expect(shown()).toEqual([
			expect.objectContaining({ context: "#geral", sound: "mention", target: { kind: "channel", channelId: "geral" } }),
		]);
	});

	it("a própria mensagem nunca avisa", () => {
		send({ type: "message.created", message: message("d1", [], "eu") });
		expect(shown()).toEqual([]);
	});

	it("a conversa expandida com o app em foco não avisa; com o app atrás de outra janela, avisa", () => {
		setNotificationContext({ focused: true, dmId: "d1" });
		send({ type: "message.created", message: message("d1") });
		expect(shown()).toEqual([]);
		setNotificationContext({ focused: false });
		send({ type: "message.created", message: message("d1") });
		expect(shown()).toHaveLength(1);
	});

	it("Ocupado cala tudo", () => {
		setNotificationContext({ status: "busy" });
		send({ type: "message.created", message: message("d1") });
		send({ type: "message.created", message: message("geral", ["eu"]) });
		expect(shown()).toEqual([]);
	});

	it("a conversa silenciada só avisa a menção", () => {
		useUnreadStore.setState({
			byChannel: { d1: { last_read_id: null, unread: 0, mentions: 0, muted: true } },
		});
		send({ type: "message.created", message: message("d1") });
		expect(shown()).toEqual([]);
		send({ type: "message.created", message: message("d1", ["eu"]) });
		expect(shown()).toHaveLength(1);
	});

	it("sem a lista de canais, não avisa (não dá para saber se é conversa)", () => {
		client.removeQueries({ queryKey: channelsKeys.layout() });
		send({ type: "message.created", message: message("d1") });
		expect(shown()).toEqual([]);
	});

	it("avisa quem passou a transmitir, mas não quem já transmitia quando o app abriu", () => {
		send({ type: "voice.participants", channel_id: "sala", participants: [participant("bia", true)] });
		expect(shown()).toEqual([]);
		send({
			type: "voice.participants",
			channel_id: "sala",
			participants: [participant("bia", true), participant("ana", true), participant("eu", true)],
		});
		expect(shown()).toEqual([
			expect.objectContaining({
				title: "ana",
				context: "Sala",
				body: "começou a transmitir",
				sound: null,
				target: { kind: "stream", channelId: "sala", userId: "ana" },
			}),
		]);
	});

	it("quem está na sala não recebe o aviso da transmissão de lá", () => {
		setNotificationContext({ voiceChannelId: "sala" });
		send({ type: "voice.participants", channel_id: "sala", participants: [] });
		send({ type: "voice.participants", channel_id: "sala", participants: [participant("ana", true)] });
		expect(shown()).toEqual([]);
	});
});
