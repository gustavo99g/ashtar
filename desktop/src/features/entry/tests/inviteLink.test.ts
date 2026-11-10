import { describe, expect, it } from "vitest";
import { normalizeInviteCode, parseInviteLink } from "../model/inviteLink";

describe("parseInviteLink", () => {
	it.each([
		["https://ashtar.exemplo.com/invite/7KQ2-M9XD-4HPA", "new"],
		["https://ashtar.exemplo.com/recovery/3RTW-8NB5-QZ6C", "recovery"],
		["http://localhost:3000/invite/7KQ2-M9XD-4HPA", "new"],
		["ashtar://invite/7KQ2-M9XD-4HPA", "new"],
		["ashtar://recovery/3RTW-8NB5-QZ6C", "recovery"],
		["ashtar-dev://invite/7KQ2-M9XD-4HPA", "new"],
		["ashtar-dev://recovery/3RTW-8NB5-QZ6C", "recovery"],
	] as const)("lê o tipo pelo caminho: %s", (text, kind) => {
		expect(parseInviteLink(text)?.kind).toBe(kind);
	});

	it("devolve o código no formato da API", () => {
		expect(parseInviteLink("ashtar://invite/7kq2-m9xd-4hpa")).toEqual({
			kind: "new",
			code: "7KQ2-M9XD-4HPA",
		});
		expect(
			parseInviteLink("https://ashtar.exemplo.com/recovery/3RTW8NB5QZ6C"),
		).toEqual({
			kind: "recovery",
			code: "3RTW-8NB5-QZ6C",
		});
	});

	it("aceita barra no fim, parâmetros, espaços e maiúsculas no caminho", () => {
		const expected = { kind: "new", code: "7KQ2-M9XD-4HPA" };
		expect(parseInviteLink("ashtar://invite/7KQ2-M9XD-4HPA/")).toEqual(
			expected,
		);
		expect(
			parseInviteLink("https://x.com/invite/7KQ2-M9XD-4HPA?origem=zap"),
		).toEqual(expected);
		expect(
			parseInviteLink("  https://x.com/invite/7KQ2-M9XD-4HPA#topo \n"),
		).toEqual(expected);
		expect(parseInviteLink("HTTPS://X.COM/INVITE/7KQ2-M9XD-4HPA")).toEqual(
			expected,
		);
	});

	it("acha o link no meio de uma mensagem", () => {
		const message =
			"Te convidei para o Ashtar. Entra por aqui: https://ashtar.exemplo.com/invite/7KQ2-M9XD-4HPA. Vale até 24 out.";
		expect(parseInviteLink(message)).toEqual({
			kind: "new",
			code: "7KQ2-M9XD-4HPA",
		});
	});

	it.each([
		"7KQ2-M9XD-4HPA",
		"7kq2-m9xd-4hpa",
		"7KQ2M9XD4HPA",
		"7kq2m9xd4hpa",
		" 7KQ2 M9XD 4HPA ",
		"7KQ2-M9XD4HPA",
	])("aceita o código sozinho: %s", (text) => {
		expect(parseInviteLink(text)).toEqual({
			kind: "unknown",
			code: "7KQ2-M9XD-4HPA",
		});
	});

	it("troca as letras que confundem, como a API", () => {
		expect(parseInviteLink("abcd-efgh-jk0o")).toEqual({
			kind: "unknown",
			code: "ABCD-EFGH-JK00",
		});
		expect(parseInviteLink("1il1-2222-3333")).toEqual({
			kind: "unknown",
			code: "1111-2222-3333",
		});
	});

	it.each([
		"",
		"   ",
		"oi",
		"7KQ2-M9XD",
		"7KQ2-M9XD-4HPA-X",
		"7KQ2-M9XD-4HPU",
		"7KQ2-M9XD-4HP!",
		"7KQ2-M9XD-4HPÁ",
		"https://ashtar.exemplo.com/",
		"https://ashtar.exemplo.com/invite/",
		"https://ashtar.exemplo.com/invite/curto",
		"ashtar://recovery/7KQ2-M9XD",
		"https://ashtar.exemplo.com/download",
		"https://google.com",
		"<script>alert(1)</script>",
	])("recusa o que não é convite: %j", (text) => {
		expect(parseInviteLink(text)).toBeNull();
	});
});

describe("normalizeInviteCode", () => {
	it("só passa para maiúscula as letras sem acento, como o Rust", () => {
		// "ı" (i sem ponto) vira "I" no `toUpperCase` do JavaScript; a API recusaria.
		expect(normalizeInviteCode("ııı1-2222-3333")).toBeNull();
	});
});
