import { describe, expect, it } from "vitest";
import {
	BODY_MAX,
	type Card,
	type CardInput,
	cardKey,
	MAX_CARDS,
	parseCard,
	parseTarget,
	pushCard,
	shortBody,
} from "../model/cards";

function input(channelId: string, body = "oi"): CardInput {
	const target = { kind: "dm", channelId } as const;
	return {
		key: cardKey(target),
		kind: "dm",
		person: { nick: channelId, displayName: null },
		title: channelId,
		context: "Mensagem privada",
		body,
		sound: "dm",
		target,
	};
}

describe("a pilha de cartões", () => {
	it("o mais novo fica em cima", () => {
		let cards: Card[] = [];
		cards = pushCard(cards, input("ana"), 1);
		cards = pushCard(cards, input("bia"), 2);
		expect(cards.map((c) => c.title)).toEqual(["bia", "ana"]);
	});

	it("a mesma conversa atualiza o cartão dela, soma a contagem e volta para cima", () => {
		let cards: Card[] = [];
		cards = pushCard(cards, input("ana", "primeira"), 1);
		cards = pushCard(cards, input("bia"), 2);
		cards = pushCard(cards, input("ana", "segunda"), 3);
		expect(cards).toHaveLength(2);
		expect(cards[0]).toMatchObject({ title: "ana", body: "segunda", count: 2, version: 3 });
		expect(cards[1].title).toBe("bia");
	});

	it(`com ${MAX_CARDS} na tela, um cartão novo tira o mais antigo`, () => {
		let cards: Card[] = [];
		for (const [i, name] of ["ana", "bia", "caio", "duda"].entries()) {
			cards = pushCard(cards, input(name), i + 1);
		}
		expect(cards.map((c) => c.title)).toEqual(["duda", "caio", "bia"]);
	});
});

describe("o cartão entre as janelas", () => {
	it("volta igual depois de virar JSON", () => {
		const card = input("ana");
		expect(parseCard(JSON.parse(JSON.stringify(card)))).toEqual(card);
	});

	it("ignora o que não tem a forma de um cartão", () => {
		expect(parseCard(null)).toBeNull();
		expect(parseCard({ ...input("ana"), title: 3 })).toBeNull();
		expect(parseCard({ ...input("ana"), target: { kind: "dm" } })).toBeNull();
	});

	it("um som desconhecido vira silêncio", () => {
		expect(parseCard({ ...input("ana"), sound: "buzina" })?.sound).toBeNull();
	});

	it("confere cada tipo de alvo", () => {
		expect(parseTarget({ kind: "channel", channelId: "geral" })).toEqual({
			kind: "channel",
			channelId: "geral",
		});
		expect(parseTarget({ kind: "stream", channelId: "sala", userId: "ana" })).toEqual({
			kind: "stream",
			channelId: "sala",
			userId: "ana",
		});
		expect(parseTarget({ kind: "stream", channelId: "sala" })).toBeNull();
		expect(parseTarget({ kind: "app" })).toEqual({ kind: "app" });
		expect(parseTarget({ kind: "outro", channelId: "x" })).toBeNull();
	});

	it("corta a mensagem longa e junta as linhas", () => {
		expect(shortBody("oi\n\ntudo  bem?")).toBe("oi tudo bem?");
		const long = shortBody("a".repeat(500));
		expect(long).toHaveLength(BODY_MAX);
		expect(long.endsWith("…")).toBe(true);
	});
});
