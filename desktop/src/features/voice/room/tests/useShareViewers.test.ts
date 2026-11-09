import { describe, expect, it } from "vitest";
import { applyViewer, decodeViewer, encodeViewer } from "../model/viewers";

describe("quem assiste", () => {
	it("o aviso vai e volta pelo tópico", () => {
		expect(decodeViewer(encodeViewer({ watching: "u1" }))).toEqual({
			watching: "u1",
		});
		expect(decodeViewer(encodeViewer({ watching: null }))).toEqual({
			watching: null,
		});
		expect(decodeViewer(new TextEncoder().encode('{"watching":3}'))).toBeNull();
		expect(decodeViewer(new TextEncoder().encode("lixo"))).toBeNull();
	});

	it("junta só os avisos para mim, com a hora do primeiro aviso", () => {
		const none: ReadonlyMap<string, number> = new Map();
		const one = applyViewer(none, "u2", { watching: "me" }, "me", 1_000);
		expect([...one]).toEqual([["u2", 1_000]]);
		// O mesmo aviso de novo não muda nada, nem a hora.
		expect(applyViewer(one, "u2", { watching: "me" }, "me", 5_000)).toBe(one);
		expect(applyViewer(one, "u3", { watching: "outro" }, "me", 5_000)).toBe(
			one,
		);
		// Foi assistir outra pessoa, ou parou: sai.
		expect([
			...applyViewer(one, "u2", { watching: "outro" }, "me", 5_000),
		]).toEqual([]);
		expect([
			...applyViewer(one, "u2", { watching: null }, "me", 5_000),
		]).toEqual([]);
	});
});
