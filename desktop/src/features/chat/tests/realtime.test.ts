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
	return { id, nick: id, display_name: null, is_owner: false, online };
}

function message(id: string, authorId = "ana"): Message {
	return {
		id,
		channel_id: "geral",
		client_id: `c-${id}`,
		author: { id: authorId, nick: authorId, display_name: null, removed: false },
		body: "oi",
		created_at: 1,
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

	it("presence.changed troca o online de quem mudou", () => {
		const client = setup();
		handleChatRealtime(
			{ type: "presence.changed", user_id: "bia", online: true },
			client,
			first,
		);
		expect(people(client)?.map((p) => p.online)).toEqual([true, true]);
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
			user_id: "u1",
			online: ["bia"],
			channels: [{ channel_id: "geral", last_message_id: "m9" }],
		};
		vi.mocked(listMessages).mockResolvedValue({ messages: [], has_more: false });

		handleChatRealtime(ready, client, first);
		expect(people(client)?.map((p) => p.online)).toEqual([false, true]);
		expect(client.getQueryState(chatKeys.people())?.isInvalidated).toBe(false);
		expect(listMessages).not.toHaveBeenCalled();

		handleChatRealtime(ready, client, { resumed: true });
		expect(client.getQueryState(chatKeys.people())?.isInvalidated).toBe(true);
		expect(listMessages).toHaveBeenCalledWith("geral", { after: "m1" });
	});
});
