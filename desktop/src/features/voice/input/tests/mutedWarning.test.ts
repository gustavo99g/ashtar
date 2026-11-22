import { describe, expect, it } from "vitest";
import { MutedWarningState, REARM_MS } from "../model/mutedWarning";

function talk(state: MutedWarningState, speaking: boolean, ms: number) {
	let shown = 0;
	for (let t = 0; t < ms; t += 100) if (state.step(speaking, 100)) shown++;
	return shown;
}

describe("o aviso de mutado", () => {
	it("aparece na primeira fala e não repete falando sem parar", () => {
		const state = new MutedWarningState();
		expect(talk(state, true, 10_000)).toBe(1);
	});

	it("uma pausa curta entre frases não rearma; um silêncio de verdade, sim", () => {
		const state = new MutedWarningState();
		talk(state, true, 500);
		talk(state, false, REARM_MS - 500);
		expect(talk(state, true, 500)).toBe(0);
		talk(state, false, REARM_MS);
		expect(talk(state, true, 500)).toBe(1);
	});
});
