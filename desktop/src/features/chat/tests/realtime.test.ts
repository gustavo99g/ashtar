import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listMessages, type Message, type Person } from "@/lib/api";
import { chatKeys, type MessagePages } from "../queries";
import { handleChatRealtime } from "../realtime";
import { findPending, useOutbox } from "../stores/outboxStore";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	listMessages: vi.fn(),
}));

function person(id: string, online = false): Person {
	return {
		id,
		nick: id,
		display_name: null,
		is_owner: false,
		online,
		status: "available",
	};
}

function message(id: string, authorId = "ana"): Message {
	return {
		id,
		channel_id: "geral",
		client_id: `c-${id}`,
		author: { id: authorId, nick: authorId, display_name: null, removed: false },
		body: "oi",
		mentions: [],
		created_at: 1,
		kind: "text",
		edited_at: null,
		reply_to: null,
		reactions: [],
		pinned_at: null,
		attachments: [],
		call: null,
	};
}

function setup() {
	const client = new QueryClient();
	client.setQueryData<Person[]>(chatKeys.people(), [
		person("ana", true),
		person("bia"),
	]);
	client.setQueryData<MessagePages>(chatKeys.messages("geral"), {
		pages: [{ messages: [message("m1")], has_more: false }],
		pageParams: [null],
	});
	return client;
}

const first = { resumed: false };
const people = (client: QueryClient) =>
	client.getQueryData<Person[]>(chatKeys.people());
const history = (client: QueryClient) =>
	client
		.getQueryData<MessagePages>(chatKeys.messages("geral"))
		?.pages.flatMap((p) => p.messages);

afterEach(() => {
	vi.mocked(listMessages).mockReset();
	useOutbox.setState({ pending: [] });
});

describe("handleChatRealtime", () => {
	it("message.created entra no histórico e solta a caixa de saída", () => {
		const client = setup();
		useOutbox.setState({
			pending: [
				{
					client_id: "c-m2",
					channel_id: "geral",
					body: "oi",
					created_at: 1,
					status: "sending",
				},
			],
		});
		handleChatRealtime({ type: "message.created", message: message("m2") }, client, first);
		expect(history(client)?.map((m) => m.id)).toEqual(["m1", "m2"]);
		expect(findPending("c-m2")).toBeUndefined();
	});

	it("presence.changed troca o online e o status de quem mudou", () => {
		const client = setup();
		handleChatRealtime(
			{
				type: "presence.changed",
				user_id: "bia",
				online: true,
				status: "busy",
			},
			client,
			first,
		);
		expect(people(client)?.map((p) => p.online)).toEqual([true, true]);
		expect(people(client)?.map((p) => p.status)).toEqual(["available", "busy"]);
	});

	it("member.joined entra uma vez; member.left sai e marca as mensagens", () => {
		const client = setup();
		const caio = person("caio");
		handleChatRealtime({ type: "member.joined", person: caio }, client, first);
		handleChatRealtime({ type: "member.joined", person: caio }, client, first);
		expect(people(client)?.map((p) => p.id)).toEqual(["ana", "bia", "caio"]);

		handleChatRealtime({ type: "member.left", user_id: "ana" }, client, first);
		expect(people(client)?.map((p) => p.id)).toEqual(["bia", "caio"]);
		expect(history(client)?.[0].author.removed).toBe(true);
	});

	it("todo ready traz quem está online; só o da volta busca o que faltou", () => {
		const client = setup();
		const ready = {
			type: "ready" as const,
			call: null,
			user_id: "u1",
			online: ["ana", "bia"],
			busy: ["ana"], away: [],
			status: "available" as const,
			channels: [
				{
					channel_id: "geral",
					last_message_id: "m9",
					state: { last_read_id: null, unread: 0, mentions: 0, muted: false },
				},
			],
			dms: [],
		};
		vi.mocked(listMessages).mockResolvedValue({ messages: [], has_more: false });

		handleChatRealtime(ready, client, first);
		expect(people(client)?.map((p) => p.online)).toEqual([true, true]);
		expect(people(client)?.map((p) => p.status)).toEqual(["busy", "available"]);
		expect(client.getQueryState(chatKeys.people())?.isInvalidated).toBe(false);
		expect(listMessages).not.toHaveBeenCalled();

		handleChatRealtime(ready, client, { resumed: true });
		expect(client.getQueryState(chatKeys.people())?.isInvalidated).toBe(true);
		expect(listMessages).toHaveBeenCalledWith("geral", { after: "m1" });
	});

	it("user.updated troca o nome e a foto na lista de pessoas e nas mensagens", () => {
		const client = setup();
		handleChatRealtime(
			{
				type: "user.updated",
				id: "ana",
				display_name: "Ana Clara",
				avatar: "f1",
			},
			client,
			first,
		);
		expect(people(client)?.[0]).toMatchObject({
			display_name: "Ana Clara",
			avatar: "f1",
		});
		expect(people(client)?.[1].avatar).toBeUndefined();
		expect(history(client)?.[0].author).toMatchObject({
			display_name: "Ana Clara",
			avatar: "f1",
		});
	});
});
