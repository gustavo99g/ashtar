import { describe, expect, it } from "vitest";
import { expiryTime, inviteAddress } from "../format";

describe("textos do bilhete", () => {
	it("tira o protocolo e o código do link", () => {
		expect(
			inviteAddress("https://ashtar.exemplo.ts.net/invite/7KQ2", "7KQ2"),
		).toBe("ashtar.exemplo.ts.net/invite/");
	});

	it("escreve a hora com dois dígitos", () => {
		const at = new Date(2026, 9, 18, 9, 5).getTime() / 1000;
		expect(expiryTime(at)).toBe("09:05");
	});
});
