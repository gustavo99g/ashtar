import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
	type Message,
	markRead,
	type ReadState,
	setMuted,
} from "@/lib/api";
import { handleUnreadRealtime } from "../realtime";
import {
	applyState,
	EMPTY_STATE,
	markChannelRead,
	seedMissing,
	setChannelMuted,
	shownCount,
	UNREAD_CAP,
	useUnreadStore,
	useUnreadTotal,
} from "../store";

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	markRead: vi.fn(),
	setMuted: vi.fn(),
}));

function state(overrides: Partial<ReadState> = {}): ReadState {
	return { ...EMPTY_STATE, ...overrides };
}

function message(
	id: string,
	channelId = "geral",
	author = "ana",
	mentions: string[] = [],
): Message {
	return {
		id,
		channel_id: channelId,
		client_id: `c-${id}`,
		author: { id: author, nick: author, display_name: null, removed: false },
		body: id,
		mentions,
		created_at: 1,
		kind: "text",
		call: null,
	};
}

const created = (m: Message) =>
	handleUnreadRealtime({ type: "message.created", message: m });
const of = (id: string) => useUnreadStore.getState().byChannel[id];

beforeEach(() => {
	handleUnreadRealtime({
		type: "ready",
		call: null,
		user_id: "kid",
		status: "available",
		online: [],
		busy: [],
		channels: [
			{
				channel_id: "geral",
				last_message_id: "m3",
				state: state({ last_read_id: "m1", unread: 2 }),
			},
		],
		dms: [
			{
				channel_id: "d-ana",
				last_message_id: null,
				state: state(),
			},
		],
	});
});

describe("as não lidas", () => {
	it("o ready troca tudo, canais e conversas", () => {
		useUnreadStore.setState((s) => ({
			byChannel: { ...s.byChannel, velho: state({ unread: 9 }) },
		}));
		handleUnreadRealtime({
			type: "ready",
			call: null,
			user_id: "kid",
			status: "available",
			online: [],
			busy: [],
			channels: [],
			dms: [{ channel_id: "d-ana", last_message_id: null, state: state() }],
		});
		expect(Object.keys(useUnreadStore.getState().byChannel)).toEqual(["d-ana"]);
	});

	it("mensagem dos outros soma uma; com menção a mim, soma a menção também", () => {
		created(message("m4"));
		expect(of("geral")).toEqual(state({ last_read_id: "m1", unread: 3 }));
		created(message("m5", "geral", "bia", ["kid"]));
		expect(of("geral")).toEqual(
			state({ last_read_id: "m1", unread: 4, mentions: 1 }),
		);
		created(message("m6", "geral", "bia", ["ana"]));
		expect(of("geral").mentions).toBe(1);
	});

	it("a minha leva o ponteiro até ela e zera, como a API", () => {
		created(message("m4", "geral", "kid"));
		expect(of("geral")).toEqual(state({ last_read_id: "m4" }));
	});

	it("a mesma mensagem, ou uma mais velha que a mais nova contada, não conta de novo", () => {
		created(message("m4"));
		created(message("m4"));
		created(message("m2"));
		expect(of("geral").unread).toBe(3);
	});

	it("um canal que não veio no ready começa do zero; a conta para no teto", () => {
		created(message("m1", "d-novo"));
		expect(of("d-novo")).toEqual(state({ unread: 1 }));
		useUnreadStore.setState((s) => ({
			byChannel: { ...s.byChannel, geral: state({ unread: UNREAD_CAP }) },
		}));
		created(message("m9"));
		expect(of("geral").unread).toBe(UNREAD_CAP);
	});

	it("o channel.state troca o estado do canal pelo da API", () => {
		applyState("geral", state({ last_read_id: "m3", muted: true }));
		handleUnreadRealtime({
			type: "channel.state",
			channel_id: "d-ana",
			state: state({ unread: 5 }),
		});
		expect(of("geral")).toEqual(state({ last_read_id: "m3", muted: true }));
		expect(of("d-ana").unread).toBe(5);
	});

	it("a lista de conversas só acrescenta as que faltam", () => {
		seedMissing([
			{ channel_id: "d-ana", last_message_id: "x", state: state({ unread: 7 }) },
			{ channel_id: "d-bia", last_message_id: "m5", state: state({ unread: 2 }) },
		]);
		expect(of("d-ana").unread).toBe(0);
		expect(of("d-bia").unread).toBe(2);
		// A mais nova da bia já está contada.
		created(message("m5", "d-bia"));
		expect(of("d-bia").unread).toBe(2);
	});
});

describe("marcar como lido", () => {
	it("zera na hora e fica com o que a API devolveu", async () => {
		let answer: (s: ReadState) => void = () => {};
		vi.mocked(markRead).mockReturnValue(
			new Promise((resolve) => {
				answer = resolve;
			}),
		);
		const done = markChannelRead("geral", "m3");
		expect(of("geral")).toEqual(state({ last_read_id: "m3" }));
		expect(markRead).toHaveBeenCalledWith("geral", { message_id: "m3" });

		// Chegou uma no meio: a resposta da API já conta com ela.
		answer(state({ last_read_id: "m3", unread: 1 }));
		await done;
		expect(of("geral").unread).toBe(1);
	});

	it("uma mensagem que não passa do ponteiro não vira pedido", async () => {
		vi.mocked(markRead).mockClear();
		await markChannelRead("geral", "m1");
		expect(markRead).not.toHaveBeenCalled();
	});

	it("se a API falhar, fica zerado aqui", async () => {
		vi.mocked(markRead).mockRejectedValue(new Error("rede"));
		await markChannelRead("geral", "m3");
		expect(of("geral").unread).toBe(0);
	});
});

describe("silenciar", () => {
	it("silenciado, aparece só o número das menções, também na soma", () => {
		expect(shownCount(state({ unread: 4, mentions: 1 }))).toBe(4);
		expect(shownCount(state({ unread: 4, mentions: 1, muted: true }))).toBe(1);
		applyState("geral", state({ unread: 4, mentions: 1, muted: true }));
		applyState("d-ana", state({ unread: 2 }));
		const total = renderHook(() => useUnreadTotal(["geral", "d-ana"]));
		expect(total.result.current).toBe(3);
		act(() => applyState("d-ana", state({ unread: 2, muted: true })));
		expect(total.result.current).toBe(1);
	});

	it("muda na hora; se a API recusar, volta", async () => {
		vi.mocked(setMuted).mockResolvedValue(state({ muted: true, unread: 2 }));
		await setChannelMuted("geral", true);
		expect(setMuted).toHaveBeenCalledWith("geral", { muted: true });
		expect(of("geral").muted).toBe(true);

		vi.mocked(setMuted).mockRejectedValue(new Error("rede"));
		const failing = setChannelMuted("geral", false);
		expect(of("geral").muted).toBe(false);
		await expect(failing).rejects.toThrow("rede");
		expect(of("geral").muted).toBe(true);
	});
});
