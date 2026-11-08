import { describe, expect, it } from "vitest";
import {
	DEFAULT_QUALITY,
	networkLimited,
	QUALITY_ORDER,
	QUALITY_PRESETS,
} from "../../model/presets";

describe("presets", () => {
	it("mostra Leve, Movimento e Nitidez, nessa ordem, e começa no Movimento", () => {
		expect(QUALITY_ORDER.map((q) => QUALITY_PRESETS[q].label)).toEqual([
			"Leve",
			"Movimento",
			"Nitidez",
		]);
		expect(DEFAULT_QUALITY).toBe("1080p60");
	});

	it("o Leve gasta menos que o Movimento", () => {
		expect(QUALITY_PRESETS["720p60"].bitrateKbps).toBeLessThan(
			QUALITY_PRESETS["1080p60"].bitrateKbps,
		);
	});

	it("avisa da rede abaixo de 70% do teto de cada preset", () => {
		expect(networkLimited("720p60", 2_700)).toBe(true);
		expect(networkLimited("720p60", 2_900)).toBe(false);
		expect(networkLimited("1080p60", 5_500)).toBe(true);
	});
});
