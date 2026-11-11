import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/api";
import {
	authorName,
	BODY_MAX,
	bodyParts,
	conversationRows,
	dayLabel,
	draftProblem,
	GROUP_GAP_SECONDS,
	stampLabel,
} from "../model/messages";

/** Segundos de uma data local. */
function at(year: number, month: number, day: number, hour = 12, minute = 0) {
	return Math.floor(
		new Date(year, month - 1, day, hour, minute).getTime() / 1000,
	);
}

let next = 0;
function message(authorId: string, created_at: number): Message {
	next += 1;
	return {
		id: `m${String(next).padStart(4, "0")}`,
		channel_id: "geral",
		client_id: `c${next}`,
		author: {
			id: authorId,
			nick: authorId,
			display_name: null,
			removed: false,
		},
		body: "oi",
		mentions: [],
		created_at,
	};
}

describe("draftProblem", () => {
	it("aceita o que a API aceita", () => {
		expect(draftProblem("  oi  ")).toBeNull();
		expect(draftProblem("a".repeat(BODY_MAX))).toBeNull();
		// Conta caracteres, não unidades de UTF-16: um emoji vale um.
		expect(draftProblem("😀".repeat(BODY_MAX))).toBeNull();
		expect(draftProblem(`a${"\n".repeat(5)}b`)).toBeNull();
	});

	it("recusa o que a API recusa", () => {
		expect(draftProblem("")).not.toBeNull();
		expect(draftProblem(" \n\t ")).not.toBeNull();
		expect(draftProblem("a".repeat(BODY_MAX + 1))).not.toBeNull();
		expect(draftProblem(`a${"\n".repeat(6)}b`)).not.toBeNull();
	});
});

describe("authorName", () => {
	it("usa o nome visível e, vazio, o nick", () => {
		expect(authorName({ nick: "kid", display_name: "Kid Bengala" })).toBe(
			"Kid Bengala",
		);
		expect(authorName({ nick: "kid", display_name: "  " })).toBe("kid");
		expect(authorName({ nick: "kid", display_name: null })).toBe("kid");
	});
});

describe("dayLabel", () => {
	const now = new Date(2026, 10, 1, 20, 0);

	it("Hoje, Ontem, o dia do mês e, de outro ano, o ano junto", () => {
		expect(dayLabel(at(2026, 11, 1, 0, 5), now)).toBe("Hoje");
		expect(dayLabel(at(2026, 10, 31, 23, 59), now)).toBe("Ontem");
		expect(dayLabel(at(2026, 10, 29), now)).toBe("29 de outubro");
		expect(dayLabel(at(2025, 10, 29), now)).toBe("29 de outubro de 2025");
	});
});

describe("conversationRows", () => {
	const now = new Date(2026, 10, 1, 20, 0);

	it("agrupa o mesmo autor e separa por autor, por tempo e por dia", () => {
		const base = at(2026, 10, 31, 22, 0);
		const messages = [
			message("ana", base),
			message("ana", base + 60), // mesmo grupo
			message("bia", base + 120), // outro autor
			message("bia", base + 120 + GROUP_GAP_SECONDS + 1), // passou de 5 min
			message("bia", at(2026, 11, 1, 0, 1)), // virou o dia
		];
		const rows = conversationRows(messages, now);
		expect(rows.map((r) => r.startsGroup)).toEqual([
			true,
			false,
			true,
			true,
			true,
		]);
		expect(rows.map((r) => r.day)).toEqual(["Ontem", null, null, null, "Hoje"]);
	});

	it("sem mensagens, sem linhas", () => {
		expect(conversationRows([], now)).toEqual([]);
	});
});

describe("stampLabel", () => {
	it("junta o dia e a hora, como no quadro", () => {
		const now = new Date(2026, 9, 31, 12, 0);
		const at = (date: Date) => Math.floor(date.getTime() / 1000);
		expect(stampLabel(at(new Date(2026, 9, 31, 9, 14)), now)).toBe(
			"Hoje às 09:14",
		);
		expect(stampLabel(at(new Date(2026, 9, 29, 21, 3)), now)).toBe(
			"29 de outubro às 21:03",
		);
	});
});

describe("bodyParts", () => {
	it("separa os links do texto", () => {
		expect(bodyParts("veja https://exemplo.com/a e http://b.com")).toEqual([
			{ kind: "text", text: "veja " },
			{ kind: "link", url: "https://exemplo.com/a" },
			{ kind: "text", text: " e " },
			{ kind: "link", url: "http://b.com" },
		]);
	});

	it("a pontuação do fim fica no texto", () => {
		expect(bodyParts("olha https://exemplo.com.")).toEqual([
			{ kind: "text", text: "olha " },
			{ kind: "link", url: "https://exemplo.com" },
			{ kind: "text", text: "." },
		]);
		expect(bodyParts("(veja https://exemplo.com)")).toEqual([
			{ kind: "text", text: "(veja " },
			{ kind: "link", url: "https://exemplo.com" },
			{ kind: "text", text: ")" },
		]);
	});

	it("o parêntese que é do link fica nele", () => {
		const url = "https://pt.wikipedia.org/wiki/Rust_(linguagem)";
		expect(bodyParts(`${url}.`)).toEqual([
			{ kind: "link", url },
			{ kind: "text", text: "." },
		]);
	});

	it("sem link, um pedaço só; esquema que não é da web não vira link", () => {
		expect(bodyParts("primeira\nsegunda")).toEqual([
			{ kind: "text", text: "primeira\nsegunda" },
		]);
		expect(bodyParts("file:///C:/x")).toEqual([
			{ kind: "text", text: "file:///C:/x" },
		]);
	});

	it("as menções confirmadas viram pedaço próprio; as outras e as de dentro de link, não", () => {
		const ana = { id: "a", nick: "ana", display_name: "Ana Lima" };
		expect(bodyParts("oi @Ana, @bia e https://x.com/@ana", [ana])).toEqual([
			{ kind: "text", text: "oi " },
			{ kind: "mention", text: "@Ana", person: ana },
			{ kind: "text", text: ", @bia e " },
			{ kind: "link", url: "https://x.com/@ana" },
		]);
	});
});
