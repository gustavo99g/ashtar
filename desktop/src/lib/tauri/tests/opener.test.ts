import { beforeEach, describe, expect, it, vi } from "vitest";
import { isWebLink, openLink } from "../opener";

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

beforeEach(() => {
	openUrl.mockReset();
	openUrl.mockResolvedValue(undefined);
});

describe("isWebLink", () => {
	it("aceita http e https, com qualquer caixa", () => {
		for (const url of [
			"http://exemplo.com",
			"https://exemplo.com/a?b=c",
			"HTTPS://EXEMPLO.COM",
		]) {
			expect(isWebLink(url), url).toBe(true);
		}
	});

	it("recusa o resto: arquivo, script e texto sem esquema", () => {
		for (const url of [
			"file:///C:/Windows/System32/calc.exe",
			"javascript:alert(1)",
			"ashtar://convite/AAAA",
			"exemplo.com",
			" https://exemplo.com",
			"",
		]) {
			expect(isWebLink(url), url).toBe(false);
		}
	});
});

describe("openLink", () => {
	it("abre só link da web, e um erro do plugin não escapa", async () => {
		openLink("file:///C:/x");
		expect(openUrl).not.toHaveBeenCalled();

		openUrl.mockRejectedValueOnce(new Error("sem navegador"));
		openLink("https://exemplo.com");
		expect(openUrl).toHaveBeenCalledWith("https://exemplo.com");
		// A promessa rejeitada é engolida: nada de erro solto.
		await Promise.resolve();
	});
});
