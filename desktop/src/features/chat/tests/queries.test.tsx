import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ApiError,
	listMessages,
	type Message,
	type MessagePage,
	sendMessage,
} from "@/lib/api";
import {
	appendMessages,
	catchUp,
	chatKeys,
	type MessagePages,
	markAuthorRemoved,
	useSendMessage,
} from "../queries";
import { findPending, useOutbox } from "../stores/outboxStore";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	listMessages: vi.fn(),
	sendMessage: vi.fn(),
}));

function message(id: string, authorId = "ana", channelId = "geral"): Message {
	return {
		id,
		channel_id: channelId,
		client_id: `c-${id}`,
		author: { id: authorId, nick: authorId, display_name: null, removed: false },
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
		call: null,
	};
}

function page(ids: string[], has_more = false): MessagePage {
	return { messages: ids.map((id) => message(id)), has_more };
}

/** Um histórico em cache com estas páginas (da mais antiga para a mais nova). */
function cache(client: QueryClient, channelId: string, pages: MessagePage[]) {
	client.setQueryData<MessagePages>(chatKeys.messages(channelId), {
		pages,
		pageParams: pages.map((_, i) => (i === pages.length - 1 ? null : `m${i}`)),
	});
}

function ids(client: QueryClient, channelId = "geral"): string[] {
	const data = client.getQueryData<MessagePages>(chatKeys.messages(channelId));
	return data?.pages.flatMap((p) => p.messages.map((m) => m.id)) ?? [];
}

afterEach(() => {
	vi.mocked(listMessages).mockReset();
	vi.mocked(sendMessage).mockReset();
	useOutbox.setState({ pending: [] });
});

describe("appendMessages", () => {
	it("põe no fim, em ordem de id, sem repetir", () => {
		const client = new QueryClient();
		cache(client, "geral", [page(["m1", "m2"]), page(["m3", "m5"])]);
		appendMessages(client, "geral", [message("m6"), message("m4"), message("m5")]);
		expect(ids(client)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);
	});

	it("sem o canal no cache, não cria nada", () => {
		const client = new QueryClient();
		appendMessages(client, "geral", [message("m1")]);
		expect(client.getQueryData(chatKeys.messages("geral"))).toBeUndefined();
	});
});

describe("catchUp", () => {
	it("só pergunta nos canais que andaram", async () => {
		const client = new QueryClient();
		cache(client, "geral", [page(["m1", "m2"])]);
		cache(client, "jogos", [page(["m3"])]);
		vi.mocked(listMessages).mockResolvedValue(page(["m4"]));

		await catchUp(client, [
			{ channel_id: "geral", last_message_id: "m4" },
			{ channel_id: "jogos", last_message_id: "m3" },
		]);
		expect(listMessages).toHaveBeenCalledTimes(1);
		expect(listMessages).toHaveBeenCalledWith("geral", { after: "m2" });
		expect(ids(client)).toEqual(["m1", "m2", "m4"]);
	});

	it("perdeu mais de uma página: recomeça o canal pelas mais recentes", async () => {
		const client = new QueryClient();
		cache(client, "geral", [page(["m1"], true), page(["m2", "m3"])]);
		vi.mocked(listMessages)
			.mockResolvedValueOnce(page(["m4"], true))
			.mockResolvedValueOnce(page(["m300"]));

		await catchUp(client, [{ channel_id: "geral", last_message_id: "m300" }]);
		// O reset joga fora as páginas velhas; quem estiver olhando busca a primeira de novo.
		expect(client.getQueryData(chatKeys.messages("geral"))).toBeUndefined();
	});

	it("canal vazio que ganhou mensagem recomeça, sem invalidar", async () => {
		const client = new QueryClient();
		cache(client, "geral", [page([])]);
		await catchUp(client, [{ channel_id: "geral", last_message_id: "m1" }]);
		expect(client.getQueryData(chatKeys.messages("geral"))).toBeUndefined();
		expect(listMessages).not.toHaveBeenCalled();
	});

	it("sem o ready (tempo real fora), pergunta em todos os canais em cache", async () => {
		const client = new QueryClient();
		cache(client, "geral", [page(["m1", "m2"])]);
		cache(client, "jogos", [page(["m3"])]);
		vi.mocked(listMessages).mockImplementation(async (channelId) =>
			channelId === "geral" ? page(["m4"]) : page([]),
		);

		await catchUp(client);
		expect(listMessages).toHaveBeenCalledWith("geral", { after: "m2" });
		expect(listMessages).toHaveBeenCalledWith("jogos", { after: "m3" });
		expect(ids(client)).toEqual(["m1", "m2", "m4"]);
		expect(ids(client, "jogos")).toEqual(["m3"]);
	});

	it("sem o ready, o canal vazio só recomeça se ganhou mensagem", async () => {
		const client = new QueryClient();
		cache(client, "geral", [page([])]);
		cache(client, "jogos", [page([])]);
		vi.mocked(listMessages).mockImplementation(async (channelId) =>
			channelId === "geral" ? page(["m1"]) : page([]),
		);

		await catchUp(client);
		expect(listMessages).toHaveBeenCalledWith("geral");
		expect(client.getQueryData(chatKeys.messages("geral"))).toBeUndefined();
		expect(ids(client, "jogos")).toEqual([]);
		expect(client.getQueryData(chatKeys.messages("jogos"))).toBeDefined();
	});

	it("canal que não veio no ready (arquivado) fica como está", async () => {
		const client = new QueryClient();
		cache(client, "velho", [page(["m1"])]);
		await catchUp(client, []);
		expect(listMessages).not.toHaveBeenCalled();
		expect(ids(client, "velho")).toEqual(["m1"]);
	});
});

describe("markAuthorRemoved", () => {
	it("marca só as mensagens de quem saiu, em todos os canais", () => {
		const client = new QueryClient();
		client.setQueryData<MessagePages>(chatKeys.messages("geral"), {
			pages: [{ messages: [message("m1", "ana"), message("m2", "bia")], has_more: false }],
			pageParams: [null],
		});
		client.setQueryData<MessagePages>(chatKeys.messages("jogos"), {
			pages: [{ messages: [message("m3", "ana", "jogos")], has_more: false }],
			pageParams: [null],
		});
		markAuthorRemoved(client, "ana");

		const removed = (channelId: string) =>
			client
				.getQueryData<MessagePages>(chatKeys.messages(channelId))
				?.pages.flatMap((p) => p.messages.map((m) => [m.author.id, m.author.removed]));
		expect(removed("geral")).toEqual([
			["ana", true],
			["bia", false],
		]);
		expect(removed("jogos")).toEqual([["ana", true]]);
	});
});

describe("useSendMessage", () => {
	let client: QueryClient;

	function wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
	}

	beforeEach(() => {
		client = new QueryClient();
		cache(client, "geral", [page(["m1"])]);
		vi.spyOn(crypto, "randomUUID").mockReturnValue(
			"00000000-0000-4000-8000-000000000001",
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	const clientId = "00000000-0000-4000-8000-000000000001";

	it("aparece na hora e vira mensagem quando a API confirma", async () => {
		const sent = { ...message("m2"), client_id: clientId, body: "oi" };
		let resolve: (m: Message) => void = () => {};
		vi.mocked(sendMessage).mockReturnValue(
			new Promise((r) => {
				resolve = r;
			}),
		);
		const { result } = renderHook(() => useSendMessage(), { wrapper });

		act(() => result.current.send("geral", "  oi  "));
		expect(findPending(clientId)).toMatchObject({ body: "oi", status: "sending" });
		expect(sendMessage).toHaveBeenCalledWith("geral", {
			client_id: clientId,
			body: "oi",
		});

		await act(async () => resolve(sent));
		expect(findPending(clientId)).toBeUndefined();
		expect(ids(client)).toEqual(["m1", "m2"]);
	});

	it("falhou: fica com o erro, e tentar de novo repete o mesmo client_id", async () => {
		vi.mocked(sendMessage).mockRejectedValueOnce(
			new ApiError({
				status: 429,
				kind: "too_many_messages",
				message: "Calma: muitas mensagens seguidas.",
			}),
		);
		const { result } = renderHook(() => useSendMessage(), { wrapper });

		await act(async () => result.current.send("geral", "oi"));
		expect(findPending(clientId)).toMatchObject({
			status: "failed",
			error: "Calma: muitas mensagens seguidas.",
		});

		vi.mocked(sendMessage).mockResolvedValueOnce({
			...message("m2"),
			client_id: clientId,
		});
		await act(async () => result.current.retry(clientId));
		expect(sendMessage).toHaveBeenCalledTimes(2);
		expect(vi.mocked(sendMessage).mock.calls[1][1].client_id).toBe(clientId);
		expect(findPending(clientId)).toBeUndefined();
	});

	it("se o evento chegou antes e a resposta falhou, não volta a aparecer como falha", async () => {
		let reject: (error: unknown) => void = () => {};
		vi.mocked(sendMessage).mockReturnValue(
			new Promise((_, r) => {
				reject = r;
			}),
		);
		const { result } = renderHook(() => useSendMessage(), { wrapper });
		act(() => result.current.send("geral", "oi"));

		// O `message.created` soltou a caixa de saída (o realtime.ts faz isso).
		act(() => useOutbox.setState({ pending: [] }));
		await act(async () => reject(new Error("a resposta se perdeu")));
		expect(findPending(clientId)).toBeUndefined();
	});

	it("desistir tira da caixa de saída", async () => {
		vi.mocked(sendMessage).mockRejectedValueOnce(new Error("sem rede"));
		const { result } = renderHook(() => useSendMessage(), { wrapper });
		await act(async () => result.current.send("geral", "oi"));
		expect(findPending(clientId)?.status).toBe("failed");
		act(() => result.current.discard(clientId));
		expect(findPending(clientId)).toBeUndefined();
	});
});
