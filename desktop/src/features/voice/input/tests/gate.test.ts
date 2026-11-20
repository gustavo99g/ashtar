import { describe, expect, it } from "vitest";
import {
	AUTO_MAX_DB,
	AUTO_MIN_DB,
	type GateParams,
	GateState,
	HOLD_MS,
	INITIAL_FLOOR_DB,
	levelDb,
	SILENCE_DB,
} from "../model/gate";

const VOICE: GateParams = { mode: "voice", auto: false, thresholdDb: -50, held: false };
const AUTO: GateParams = { ...VOICE, auto: true };
const PTT: GateParams = { ...VOICE, mode: "ptt" };
const BLOCK = 10;

/** `ms` de blocos de 10 ms no nível `level`. */
function run(gate: GateState, level: number, ms: number, params: GateParams) {
	for (let t = 0; t < ms; t += BLOCK) gate.step(level, BLOCK, params);
	return gate.open;
}

describe("o nível de um bloco", () => {
	it("silêncio é o piso, não -Infinity", () => {
		expect(levelDb(new Float32Array(128))).toBe(SILENCE_DB);
		expect(levelDb([])).toBe(SILENCE_DB);
	});

	it("uma onda cheia fica perto de 0 dBFS", () => {
		expect(levelDb(new Float32Array(128).fill(1))).toBe(0);
		expect(levelDb(new Float32Array(128).fill(0.1))).toBeCloseTo(-20);
	});
});

describe("a detecção de voz manual", () => {
	it("abre com a voz acima do limiar", () => {
		const gate = new GateState();
		expect(run(gate, -60, 200, VOICE)).toBe(false);
		expect(run(gate, -30, 20, VOICE)).toBe(true);
	});

	it("segura aberto um pouco depois de a voz cair, para não comer o fim da palavra", () => {
		const gate = new GateState();
		run(gate, -30, 100, VOICE);
		expect(run(gate, -80, HOLD_MS - 50, VOICE)).toBe(true);
		expect(run(gate, -80, 100, VOICE)).toBe(false);
	});

	it("um estalo de um bloco não abre", () => {
		const gate = new GateState();
		gate.step(-10, 5, VOICE);
		expect(gate.open).toBe(false);
	});
});

describe("a sensibilidade automática", () => {
	it("começa com o limiar acima do piso de um quarto quieto", () => {
		const gate = new GateState();
		expect(gate.threshold(AUTO)).toBe(INITIAL_FLOOR_DB + 15);
	});

	it("sobe devagar num ambiente barulhento e para no teto", () => {
		const gate = new GateState();
		const before = gate.threshold(AUTO);
		run(gate, -55, 1000, AUTO);
		// Um segundo de ventilador a -55 (abaixo do limiar): o piso subiu uns 3 dB, não pulou.
		expect(gate.floorDb).toBeCloseTo(INITIAL_FLOOR_DB + 3, 0);
		expect(gate.threshold(AUTO)).toBeGreaterThan(before);
		run(gate, -20, 60_000, { ...AUTO });
		expect(gate.threshold(AUTO)).toBeLessThanOrEqual(AUTO_MAX_DB);
	});

	it("desce depressa quando o ambiente fica quieto, até o mínimo", () => {
		const gate = new GateState();
		run(gate, -100, 1000, AUTO);
		expect(gate.threshold(AUTO)).toBe(AUTO_MIN_DB);
	});

	it("a voz quase não conta como ruído: com o portão aberto, o piso sobe bem devagar", () => {
		const gate = new GateState();
		run(gate, -20, 50, AUTO);
		expect(gate.open).toBe(true);
		const floor = gate.floorDb;
		run(gate, -20, 2000, AUTO);
		expect(gate.open).toBe(true);
		expect(gate.floorDb).toBeCloseTo(floor + 2, 0);
	});

	it("um ruído constante acima do limiar não deixa o portão aberto para sempre", () => {
		const gate = new GateState();
		expect(run(gate, -45, 100, AUTO)).toBe(true);
		expect(run(gate, -45, 20_000, AUTO)).toBe(false);
	});
});

describe("o pressionar para falar", () => {
	it("fica fechado com voz alta e o atalho solto", () => {
		const gate = new GateState();
		expect(run(gate, -10, 500, PTT)).toBe(false);
	});

	it("abre na hora com o atalho e fecha um pouco depois de soltar", () => {
		const gate = new GateState();
		expect(gate.step(-100, BLOCK, { ...PTT, held: true })).toBe(true);
		expect(run(gate, -100, HOLD_MS - 50, PTT)).toBe(true);
		expect(run(gate, -100, 100, PTT)).toBe(false);
	});
});
