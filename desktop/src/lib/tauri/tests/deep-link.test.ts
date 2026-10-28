import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openingLink, watchLinks } from "../deep-link";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/plugin-deep-link", () => ({
	getCurrent: vi.fn(),
	onOpenUrl: vi.fn(),
}));

describe("openingLink", () => {
	it("devolve o link que abriu o app", async () => {
		vi.mocked(getCurrent).mockResolvedValue([
			"ashtar://invite/7KQ2-M9XD-4HPA",
		]);
		await expect(openingLink()).resolves.toBe(
			"ashtar://invite/7KQ2-M9XD-4HPA",
		);
	});

	it("devolve null quando o app abriu sem link", async () => {
		vi.mocked(getCurrent).mockResolvedValue(null);
		await expect(openingLink()).resolves.toBeNull();
	});
});

describe("watchLinks", () => {
	let deliver: (urls: string[]) => void;
	const unlisten = vi.fn();

	beforeEach(() => {
		unlisten.mockClear();
		vi.mocked(onOpenUrl).mockImplementation(async (handler) => {
			deliver = handler;
			return unlisten;
		});
	});

	it("avisa cada link que chega e para de escutar", async () => {
		const onLink = vi.fn();
		const stop = watchLinks(onLink);

		deliver(["ashtar://recovery/3RTW-8NB5-QZ6C"]);
		expect(onLink).toHaveBeenCalledWith("ashtar://recovery/3RTW-8NB5-QZ6C");

		stop();
		deliver(["ashtar://invite/7KQ2-M9XD-4HPA"]);
		expect(onLink).toHaveBeenCalledTimes(1);
		await vi.waitFor(() => expect(unlisten).toHaveBeenCalled());
	});
});
