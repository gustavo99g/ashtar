import { describe, expect, it } from "vitest";
import {
	applyMention,
	findMentions,
	type Mentionable,
	mentionOptions,
	mentionQuery,
	PICKER_MAX,
} from "../model/mentions";

function person(id: string, nick: string, display_name: string | null = null): Mentionable {
	return { id, nick, display_name };
}

// Os mesmos nicks dos testes da API (`mentions.rs`).
const people = [
	person("a", "Ana"),
	person("b", "Ana Paula"),
	person("c", "zé.silva", "Zé"),
	person("d", "Bia"),
];

const ids = (text: string) => findMentions(text, people).map((r) => r.person.id);

describe("findMentions: as mesmas regras da API", () => {
	it("acha os nicks, sem ligar para maiúscula, o mais comprido primeiro", () => {
		expect(ids("oi @ana e @ANA PAULA")).toEqual(["a", "b"]);
		expect(ids("@zé.silva, vem")).toEqual(["c"]);
		expect(findMentions("fala @Bia!", people)).toEqual([
			{ start: 5, end: 9, person: people[3] },
		]);
	});

	it("o nick tem de terminar ali", () => {
		expect(ids("@anabela")).toEqual([]);
		expect(ids("@ana_")).toEqual([]);
		expect(ids("@ana.")).toEqual(["a"]);
	});

	it("não vale colado numa palavra, num e-mail nem num link", () => {
		expect(ids("eu@ana")).toEqual([]);
		expect(ids("kid.@ana kid+@ana")).toEqual([]);
		expect(ids("https://x.com/@ana")).toEqual([]);
		expect(ids("(@ana)")).toEqual(["a"]);
	});
});

describe("mentionQuery", () => {
	it("o texto depois do @ antes do cursor", () => {
		expect(mentionQuery("oi @an", 6)).toEqual({ start: 3, query: "an" });
		expect(mentionQuery("@", 1)).toEqual({ start: 0, query: "" });
		expect(mentionQuery("oi @ana paula", 13)).toEqual({
			start: 3,
			query: "ana paula",
		});
		// O cursor no meio: conta o que vem antes dele.
		expect(mentionQuery("oi @an tudo", 6)).toEqual({ start: 3, query: "an" });
	});

	it("nada sem @, com quebra de linha, espaço no começo ou dois espaços, ou num e-mail", () => {
		expect(mentionQuery("oi", 2)).toBeNull();
		expect(mentionQuery("@an\nx", 5)).toBeNull();
		expect(mentionQuery("@ ana", 5)).toBeNull();
		expect(mentionQuery("@ana  x", 7)).toBeNull();
		expect(mentionQuery("eu@an", 5)).toBeNull();
	});
});

describe("mentionOptions", () => {
	it("começa com primeiro, depois contém; nick ou nome; sem acento; sem você", () => {
		expect(mentionOptions(people, "an", "d").map((p) => p.id)).toEqual(["a", "b"]);
		expect(mentionOptions(people, "ze", null).map((p) => p.id)).toEqual(["c"]);
		expect(mentionOptions(people, "paula", null).map((p) => p.id)).toEqual(["b"]);
		expect(mentionOptions(people, "", "a").map((p) => p.id)).toEqual(["b", "d", "c"]);
	});

	it("no máximo", () => {
		const many = Array.from({ length: 20 }, (_, i) => person(`p${i}`, `p${i}`));
		expect(mentionOptions(many, "p", null)).toHaveLength(PICKER_MAX);
	});
});

describe("applyMention", () => {
	it("troca o @texto pelo @nick com espaço, e o cursor vai para depois", () => {
		expect(applyMention("oi @an", 3, 6, "Ana Paula")).toEqual({
			text: "oi @Ana Paula ",
			caret: 14,
		});
		// Já havia um espaço depois: não dobra.
		expect(applyMention("@b tudo bem", 0, 2, "Bia")).toEqual({
			text: "@Bia tudo bem",
			caret: 5,
		});
	});
});
