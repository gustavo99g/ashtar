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

	it("junta só os avisos para mim, e o mesmo aviso não muda nada", () => {
		const none: ReadonlySet<string> = new Set();
		const one = applyViewer(none, "u2", { watching: "me" }, "me");
		expect([...one]).toEqual(["u2"]);
		expect(applyViewer(one, "u2", { watching: "me" }, "me")).toBe(one);
		expect(applyViewer(one, "u3", { watching: "outro" }, "me")).toBe(one);
		// Foi assistir outra pessoa, ou parou: sai.
		expect([...applyViewer(one, "u2", { watching: "outro" }, "me")]).toEqual(
			[],
		);
		expect([...applyViewer(one, "u2", { watching: null }, "me")]).toEqual([]);
	});
});
