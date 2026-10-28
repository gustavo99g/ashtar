import { beforeEach, describe, expect, it, vi } from "vitest";
import { openingLink } from "@/lib/tauri/deep-link";

vi.mock("@/lib/tauri/deep-link", () => ({ openingLink: vi.fn() }));

/** O módulo guarda a leitura da abertura: cada teste começa com um novo. */
async function load() {
	vi.resetModules();
	return import("../pendingLink");
}

beforeEach(() => {
	vi.mocked(openingLink).mockReset();
});

describe("loadOpeningLink", () => {
	it("guarda o convite do link que abriu o app, e só lê uma vez", async () => {
		vi.mocked(openingLink).mockResolvedValue("ashtar://invite/7kq2-m9xd-4hpa");
		const { loadOpeningLink, usePendingLinkStore } = await load();

		await Promise.all([loadOpeningLink(), loadOpeningLink()]);

		expect(usePendingLinkStore.getState()).toEqual({
			ready: true,
			pending: { kind: "new", code: "7KQ2-M9XD-4HPA" },
		});
		expect(openingLink).toHaveBeenCalledTimes(1);
	});

	it("sem link, ou com um link que não é convite, abre sem convite", async () => {
		vi.mocked(openingLink).mockResolvedValue("ashtar://outra-coisa");
		const { loadOpeningLink, usePendingLinkStore } = await load();

		await loadOpeningLink();

		expect(usePendingLinkStore.getState()).toEqual({
			ready: true,
			pending: null,
		});
	});

	it("uma falha do plugin conta como abrir sem link", async () => {
		vi.mocked(openingLink).mockRejectedValue(new Error("plugin"));
		const { loadOpeningLink, usePendingLinkStore } = await load();

		await loadOpeningLink();

		expect(usePendingLinkStore.getState()).toEqual({
			ready: true,
			pending: null,
		});
	});
});

describe("nextEntryPath", () => {
	it("espera a leitura da abertura e tira o link quando o usa", async () => {
		const { nextEntryPath, usePendingLinkStore } = await load();
		const noAccount = { status: "noAccount" } as const;

		expect(nextEntryPath(noAccount)).toBeNull();

		usePendingLinkStore.setState({
			ready: true,
			pending: { kind: "recovery", code: "3RTW-8NB5-QZ6C" },
		});
		expect(nextEntryPath({ status: "entering" })).toBeNull();
		expect(usePendingLinkStore.getState().pending).not.toBeNull();

		expect(nextEntryPath(noAccount)).toBe("/entry/recovery/3RTW-8NB5-QZ6C");
		expect(usePendingLinkStore.getState().pending).toBeNull();
		expect(nextEntryPath(noAccount)).toBe("/entry/no-invite");
	});
});
