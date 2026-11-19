import { describe, expect, it } from "vitest";
import {
	applyViewer,
	decodeViewer,
	EMPTY_TABLE,
	encodeViewer,
	removeViewer,
	viewersOf,
} from "../model/viewers";

const encode = (text: string) => new TextEncoder().encode(text);

describe("quem assiste", () => {
	it("o aviso vai e volta pelo tópico, com a lista", () => {
		expect(decodeViewer(encodeViewer({ watching: ["u1", "u2"] }))).toEqual({
			watching: ["u1", "u2"],
		});
		expect(decodeViewer(encodeViewer({ watching: [] }))).toEqual({
			watching: [],
		});
		expect(decodeViewer(encode('{"watching":3}'))).toBeNull();
		expect(decodeViewer(encode('{"watching":["u1",3]}'))).toBeNull();
		expect(decodeViewer(encode("lixo"))).toBeNull();
	});

	it("lê o aviso da 0.3, de uma transmissão só", () => {
		expect(decodeViewer(encode('{"watching":"u1"}'))).toEqual({
			watching: ["u1"],
		});
		expect(decodeViewer(encode('{"watching":null}'))).toEqual({
			watching: [],
		});
	});

	it("junta quem assiste cada transmissão, com a hora do primeiro aviso", () => {
		const one = applyViewer(
			EMPTY_TABLE,
			"bia",
			{ watching: ["juju", "kid"] },
			1_000,
		);
		const two = applyViewer(one, "caio", { watching: ["kid"] }, 2_000);
		expect([...viewersOf(two, "kid")]).toEqual([
			["bia", 1_000],
			["caio", 2_000],
		]);
		expect([...viewersOf(two, "juju")]).toEqual([["bia", 1_000]]);

		// O mesmo aviso de novo não muda nada, nem a hora.
		expect(applyViewer(two, "caio", { watching: ["kid"] }, 9_000)).toBe(two);

		// A bia fecha a da juju e continua na do kid, com a hora de antes.
		const three = applyViewer(two, "bia", { watching: ["kid"] }, 5_000);
		expect([...viewersOf(three, "juju")]).toEqual([]);
		expect(viewersOf(three, "kid").get("bia")).toBe(1_000);
	});

	it("ninguém assiste a si mesmo, e quem sai da sala sai da tabela", () => {
		const table = applyViewer(
			EMPTY_TABLE,
			"bia",
			{ watching: ["bia", "kid"] },
			1_000,
		);
		expect([...viewersOf(table, "bia")]).toEqual([]);
		expect([...viewersOf(removeViewer(table, "bia"), "kid")]).toEqual([]);
		expect(removeViewer(table, "ninguem")).toBe(table);
	});

	it("parar de assistir tudo tira a pessoa", () => {
		const table = applyViewer(EMPTY_TABLE, "bia", { watching: ["kid"] }, 1);
		expect(applyViewer(table, "bia", { watching: [] }, 2).size).toBe(0);
	});
});
