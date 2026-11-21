import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { channelsKeys } from "@/features/channels";
import type { Conversation, Layout, Message, ServerEvent } from "@/lib/api";
import { dmsKeys } from "../queries";
import { handleDmsRealtime } from "../realtime";

const layout: Layout = {
	version: 1,
	top: [
		{
			id: "geral",
			kind: "text",
			name: "geral",
			topic: null,
			category_id: null,
			archived_at: null,
			restricted: false,
		},
	],
	categories: [],
};

function message(id: string, channelId: string): Message {
	return {
		id,
		channel_id: channelId,
		client_id: `c-${id}`,
		author: { id: "ana", nick: "ana", display_name: null, removed: false },
		body: `mensagem ${id}`,
		mentions: [],
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

const withAna: Conversation = {
	id: "d1",
	person: { id: "ana", nick: "ana", display_name: null, removed: false },
	last_message: message("m1", "d1"),
	state: { last_read_id: null, unread: 0, mentions: 0, muted: false },
};

function setup() {
	const client = new QueryClient();
	client.setQueryData(channelsKeys.layout(), layout);
	client.setQueryData(dmsKeys.list(), [withAna]);
	const invalidate = vi.spyOn(client, "invalidateQueries");
	const send = (event: ServerEvent, resumed = false) =>
		handleDmsRealtime(event, client, { resumed });
	const list = () => client.getQueryData<Conversation[]>(dmsKeys.list());
	return { client, invalidate, send, list };
}

describe("handleDmsRealtime", () => {
	it("a mensagem de uma conversa conhecida vira a última dela, sem pedido", () => {
		const { send, list, invalidate } = setup();
		send({ type: "message.created", message: message("m2", "d1") });
		expect(list()?.[0].last_message?.id).toBe("m2");
		// Uma mais velha que chega atrasada não volta a ser a última.
		send({ type: "message.created", message: message("m0", "d1") });
		expect(list()?.[0].last_message?.id).toBe("m2");
		expect(invalidate).not.toHaveBeenCalled();
	});

	it("a mensagem de um canal da árvore não é daqui", () => {
		const { send, list, invalidate } = setup();
		send({ type: "message.created", message: message("m2", "geral") });
		expect(list()).toEqual([withAna]);
		expect(invalidate).not.toHaveBeenCalled();
	});

	it("a de um canal desconhecido é uma conversa nova: busca a lista", () => {
		const { send, invalidate } = setup();
		send({ type: "message.created", message: message("m2", "d9") });
		expect(invalidate).toHaveBeenCalledWith({ queryKey: dmsKeys.list() });
	});

	it("quem saiu do grupo e a volta de uma queda buscam a lista", () => {
		const { send, invalidate } = setup();
		const ready: ServerEvent = {
			type: "ready",
			call: null,
			user_id: "eu",
			status: "available",
			online: [],
			busy: [], away: [],
			channels: [],
			dms: [],
		};
		send(ready);
		expect(invalidate).not.toHaveBeenCalled();
		send(ready, true);
		expect(invalidate).toHaveBeenCalledTimes(1);
		send({ type: "member.left", user_id: "ana" });
		expect(invalidate).toHaveBeenCalledTimes(2);
	});
});
