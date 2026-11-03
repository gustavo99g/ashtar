import { describe, expect, it } from "vitest";
import { formatValidUntil } from "../model/validUntil";

/** Segundos Unix de uma data na hora local, como a API manda o `expires_at`. */
function unix(...parts: [number, number, number, number, number]): number {
	return new Date(...parts).getTime() / 1000;
}

describe("formatValidUntil", () => {
	const now = new Date(2026, 9, 18, 21, 5);

	it("no mesmo dia, diz hoje", () => {
		expect(formatValidUntil(unix(2026, 9, 18, 21, 35), now)).toBe(
			"hoje, 21:35",
		);
		expect(formatValidUntil(unix(2026, 9, 18, 23, 9), now)).toBe("hoje, 23:09");
	});

	it("em outro dia, diz o dia e o mês", () => {
		expect(formatValidUntil(unix(2026, 9, 24, 12, 15), now)).toBe(
			"24 out, 12:15",
		);
		expect(formatValidUntil(unix(2026, 9, 19, 0, 5), now)).toBe(
			"19 out, 00:05",
		);
		expect(formatValidUntil(unix(2026, 10, 1, 8, 0), now)).toBe("1 nov, 08:00");
	});
});
