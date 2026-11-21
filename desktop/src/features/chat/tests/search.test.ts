import { describe, expect, it } from "vitest";
import {
	completeFilter,
	filterAtEnd,
	highlight,
	parseSearch,
} from "../model/search";

const channels = [
	{ id: "c1", name: "geral" },
	{ id: "c2", name: "música" },
];

describe("parseSearch", () => {
	it("separa os filtros das palavras", () => {
		expect(
			parseSearch("bora de:@Ana em:#musica tem:Vídeo jogar", channels),
		).toEqual({ q: "bora jogar", author: "Ana", channelId: "c2", has: "video" });
	});

	it("sem em:, busca no canal aberto; o canal que não existe fica vazio", () => {
		expect(parseSearch("oi", channels, "c1")).toEqual({ q: "oi", channelId: "c1" });
		expect(parseSearch("oi em:#nada", channels, "c1").channelId).toBe("");
	});

	it("tem: que não é filtro vira palavra", () => {
		expect(parseSearch("tem:bolo", channels)).toEqual({ q: "tem:bolo" });
	});
});

describe("as sugestões", () => {
	it("acha o filtro no fim e completa", () => {
		expect(filterAtEnd("oi de:An")).toEqual({ kind: "de", partial: "an", start: 3 });
		expect(filterAtEnd("oi em:#mú")).toEqual({ kind: "em", partial: "mu", start: 3 });
		expect(filterAtEnd("oi de:ana ")).toBeNull();
		expect(completeFilter("oi de:An", 3, "de:ana")).toBe("oi de:ana ");
	});
});

describe("highlight", () => {
	it("destaca o começo das palavras, sem acento", () => {
		expect(highlight("Você vai jogar?", "voce jog")).toEqual([
			{ text: "Você", hit: true },
			{ text: " vai ", hit: false },
			{ text: "jog", hit: true },
			{ text: "ar?", hit: false },
		]);
	});

	it("texto longo começa perto do primeiro destaque", () => {
		const text = `${"palavra ".repeat(20)}achei aqui`;
		const parts = highlight(text, "achei", 40);
		expect(parts[0].text.startsWith("…")).toBe(true);
		expect(parts.find((p) => p.hit)?.text).toBe("achei");
	});
});
