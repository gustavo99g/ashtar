import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_INPUT, readInput } from "../stores/inputStore";

afterEach(() => localStorage.clear());

describe("as opções do microfone guardadas", () => {
	it("sem nada guardado, valem os padrões", () => {
		expect(readInput(undefined)).toEqual(DEFAULT_INPUT);
	});

	it("um valor estranho volta para o padrão, e um fora da faixa é limitado", () => {
		expect(
			readInput({ volume: 999, thresholdDb: -500, mode: "grito", echoCancellation: "sim" }),
		).toMatchObject({
			volume: 200,
			thresholdDb: -100,
			mode: "voice",
			echoCancellation: true,
		});
		expect(readInput({ volume: Number.NaN }).volume).toBe(100);
	});

	it("quem desligou a supressão na 0.5 continua com ela desligada", () => {
		localStorage.setItem(
			"ashtar-noise",
			JSON.stringify({ state: { suppression: false }, version: 0 }),
		);
		expect(readInput(undefined).suppression).toBe(false);
		// O que já foi guardado na 0.6 vale mais.
		expect(readInput({ suppression: true }).suppression).toBe(true);
	});
});
