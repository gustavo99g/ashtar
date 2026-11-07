import { describe, expect, it } from "vitest";
import { checkNick, sameNick } from "../model/nickRules";

describe("checkNick", () => {
	// Os mesmos casos do teste da API (`users.rs`).
	it.each([
		["  Kid  ", "Kid"],
		["João.Silva_2", "João.Silva_2"],
		["Dois Nomes", "Dois Nomes"],
		["marcão", "marcão"],
		["x-9", "x-9"],
	])("aceita %j", (input, nick) => {
		expect(checkNick(input)).toMatchObject({ nick, valid: true, error: null });
	});

	it.each([
		["a".repeat(33), "O nick precisa ter de 2 a 32 caracteres."],
		["emoji 😀", "Use só letras, números, espaço, _, - e ponto no nick."],
		["<script>", "Use só letras, números, espaço, _, - e ponto no nick."],
		["dois  espacos", "O nick não pode ter dois espaços seguidos."],
	])("recusa %j com a mensagem da API", (input, error) => {
		expect(checkNick(input)).toMatchObject({ valid: false, error });
	});

	it("conta as letras com acento como uma só", () => {
		expect(checkNick("ç".repeat(32)).valid).toBe(true);
		expect(checkNick("ç".repeat(33)).valid).toBe(false);
	});

	it("curto demais não é erro, é ajuda", () => {
		expect(checkNick("a")).toEqual({
			nick: "a",
			valid: false,
			error: null,
			hint: "O nick precisa ter pelo menos 2 caracteres.",
		});
	});

	it("a ajuda muda conforme a pessoa digita", () => {
		const start =
			"De 2 a 32 caracteres: letras, números, espaço, _, - e ponto.";
		expect(checkNick("").hint).toBe(start);
		expect(checkNick("   ").hint).toBe(start);
		expect(checkNick("kid").hint).toBe(
			"O nome que aparece para o grupo você troca quando quiser.",
		);
		expect(checkNick("").valid).toBe(false);
	});
});

describe("sameNick", () => {
	it("ignora a caixa só das letras sem acento, como o banco", () => {
		expect(sameNick("Kid", "kid")).toBe(true);
		expect(sameNick(" kid ", "KID")).toBe(true);
		expect(sameNick("JOÃO", "joão")).toBe(false);
		expect(sameNick("kid", "kidd")).toBe(false);
	});
});
