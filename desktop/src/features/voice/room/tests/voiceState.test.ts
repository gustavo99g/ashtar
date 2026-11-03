import { describe, expect, it } from "vitest";
import { encodeVoiceState, parseVoiceState, withDeafened } from "../model/voiceState";

describe("voiceState", () => {
	it("o aviso volta igual do outro lado", () => {
		expect(parseVoiceState(encodeVoiceState({ deafened: true }))).toEqual({
			deafened: true,
		});
		expect(parseVoiceState(encodeVoiceState({ deafened: false }))).toEqual({
			deafened: false,
		});
	});

	it.each([
		["texto solto", "oi"],
		["sem o campo", '{"muted":true}'],
		["com o campo errado", '{"deafened":"sim"}'],
		["um JSON que não é objeto", "true"],
	])("ignora %s", (_, text) => {
		expect(parseVoiceState(new TextEncoder().encode(text))).toBeNull();
	});

	it("withDeafened só cria um conjunto novo quando muda", () => {
		const empty: ReadonlySet<string> = new Set();
		const one = withDeafened(empty, "u1", true);
		expect([...one]).toEqual(["u1"]);
		expect(withDeafened(one, "u1", true)).toBe(one);
		expect([...withDeafened(one, "u1", false)]).toEqual([]);
		expect(withDeafened(empty, "u1", false)).toBe(empty);
	});
});
