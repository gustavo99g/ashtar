import { describe, expect, it } from "vitest";
import type { Conversation, Message, Person } from "@/lib/api";
import {
	agoLabel,
	listedConversations,
	peopleToStart,
	preview,
} from "../model/conversations";

function message(id: string, authorId: string, body = "oi"): Message {
	return {
		id,
		channel_id: "d",
		client_id: `c-${id}`,
		author: { id: authorId, nick: authorId, display_name: null, removed: false },
		body,
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

function conversation(
	id: string,
	nick: string,
	last: Message | null,
	display_name: string | null = null,
): Conversation {
	return {
		id,
		person: { id: nick, nick, display_name, removed: false },
		last_message: last,
		state: { last_read_id: null, unread: 0, mentions: 0, muted: false },
	};
}

function person(id: string, display_name: string | null = null): Person {
	return {
		id,
		nick: id,
		display_name,
		is_owner: false,
		online: true,
		status: "available",
	};
}

describe("a lista de conversas", () => {
	const list = [
		conversation("d1", "ana", message("m1", "ana")),
		conversation("d2", "bia", message("m3", "eu")),
		conversation("d3", "zé", null),
		conversation("d4", "caio", message("m2", "caio"), "Caio César"),
	];

	it("vai da que andou por último para a mais parada, sem as vazias", () => {
		expect(listedConversations(list).map((c) => c.id)).toEqual([
			"d2",
			"d4",
			"d1",
		]);
	});

	it("as com não lidas vêm primeiro, cada grupo da mais recente para a mais parada", () => {
		const unread: Record<string, number> = { d1: 3, d4: 1 };
		expect(
			listedConversations(list, "", (id) => unread[id] ?? 0).map((c) => c.id),
		).toEqual(["d4", "d1", "d2"]);
	});

	it("a busca olha o nick e o nome, sem ligar para acento nem maiúscula", () => {
		expect(listedConversations(list, "  CESAR ").map((c) => c.id)).toEqual([
			"d4",
		]);
		expect(listedConversations(list, "bi").map((c) => c.id)).toEqual(["d2"]);
		expect(listedConversations(list, "ninguém")).toEqual([]);
	});

	it("para começar: quem não tem conversa com mensagem, menos eu", () => {
		const people = [
			person("eu"),
			person("ana"),
			person("zé"),
			person("duda", "Duda"),
		];
		// O zé tem conversa aberta, mas vazia: ainda é "começar".
		expect(peopleToStart(people, list, "eu").map((p) => p.id)).toEqual([
			"duda",
			"zé",
		]);
		expect(peopleToStart(people, list, "eu", "ze").map((p) => p.id)).toEqual([
			"zé",
		]);
	});

	it("o começo da última mensagem diz quando fui eu", () => {
		expect(preview(list[1], "eu")).toBe("Você: oi");
		expect(preview(list[0], "eu")).toBe("oi");
		expect(preview(list[2], "eu")).toBe("");
		const lines = conversation("d", "ana", message("m", "ana", "um\n\n  dois"));
		expect(preview(lines, "eu")).toBe("um dois");
	});

	it("o registro de uma ligação vira o resultado dela", () => {
		const call = (outcome: "missed" | "answered", author: string) =>
			conversation("d", "ana", {
				...message("m", author, "Ligação"),
				kind: "call",
				edited_at: null,
				reply_to: null,
				reactions: [],
				pinned_at: null,
				attachments: [],
				previews: [],
				forwarded: null,
				call: { id: "c", outcome, duration: outcome === "answered" ? 60 : null },
			});
		expect(preview(call("missed", "ana"), "eu")).toBe("Chamada perdida");
		expect(preview(call("missed", "eu"), "eu")).toBe("Ninguém atendeu");
		expect(preview(call("answered", "ana"), "eu")).toBe("Ligação encerrada");
	});
});

describe("há quanto tempo", () => {
	const now = new Date(2026, 10, 10, 15, 0, 0).getTime();
	const at = (date: Date) => Math.floor(date.getTime() / 1000);

	it("agora, minutos, a hora de hoje, ontem e a data", () => {
		expect(agoLabel(at(new Date(2026, 10, 10, 14, 59, 30)), now)).toBe("agora");
		expect(agoLabel(at(new Date(2026, 10, 10, 14, 57, 0)), now)).toBe("3 min");
		expect(agoLabel(at(new Date(2026, 10, 10, 9, 5, 0)), now)).toBe("09:05");
		expect(agoLabel(at(new Date(2026, 10, 9, 23, 0, 0)), now)).toBe("ontem");
		expect(agoLabel(at(new Date(2026, 10, 3, 12, 0, 0)), now)).toBe("03/11");
	});
});
