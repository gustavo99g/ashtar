import { describe, expect, it } from "vitest";
import { shortDate } from "../date";

/** Segundos de uma data local de 2026. */
const at = (day: number, hour: number, minute: number, month = 9) =>
	new Date(2026, month, day, hour, minute).getTime() / 1000;

describe("shortDate", () => {
	it("escreve a data curta como no canvas", () => {
		expect(shortDate(at(24, 12, 15))).toBe("24 out");
		expect(shortDate(at(3, 8, 0, 2))).toBe("3 mar");
	});
});
