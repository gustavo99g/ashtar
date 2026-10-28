import { describe, expect, it } from "vitest";
import {
	avatarInitial,
	NICK_COLORS,
	nickColor,
	nickColorIndex,
	nickHash,
} from "../nickColor";

/** Os mesmos casos do teste da API (`api/`): se um mudar, o outro tem de mudar junto. */
const CASES: [nick: string, index: number][] = [
	["kid", 7],
	["Kid", 7],
	["KID", 7],
	["juliana", 7],
	["marcao", 4],
	["rafa.gomes", 6],
	["thiago", 1],
	["luana", 4],
	["pedro.h", 7],
	["carla", 2],
	["João", 1],
	["joão", 1],
	["JOÃO", 1],
	["ab", 2],
	["zé", 1],
	["a b", 2],
	["x_y-z.w", 7],
];

describe("nickColor", () => {
	it.each(CASES)("%s fica na cor %i", (nick, index) => {
		expect(nickColorIndex(nick)).toBe(index);
		expect(nickColor(nick)).toBe(NICK_COLORS[index]);
	});

	it("bate com o hash da API", () => {
		expect(nickHash("kid")).toBe(2096616551);
		expect(nickHash("carla")).toBe(2214914850);
	});

	it("dá as cores do canvas", () => {
		expect(nickColor("kid")).toBe("#2563eb");
		expect(nickColor("marcao")).toBe("#0e7490");
		expect(nickColor("carla")).toBe("#15803d");
	});
});

describe("avatarInitial", () => {
	it("usa o nome visível quando existe", () => {
		expect(avatarInitial("kid", "Gustavo")).toBe("G");
	});

	it("usa o nick quando o nome está vazio", () => {
		expect(avatarInitial("kid", null)).toBe("K");
		expect(avatarInitial("kid", "   ")).toBe("K");
	});

	it("põe acento em maiúscula e pula o que não é letra", () => {
		expect(avatarInitial("ana", "élida")).toBe("É");
		expect(avatarInitial("x_y-z.w")).toBe("X");
		expect(avatarInitial("juju", "✨ juju")).toBe("J");
		expect(avatarInitial("_ana")).toBe("A");
		expect(avatarInitial("___")).toBe("_");
		expect(avatarInitial("")).toBe("?");
	});
});
