import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_THEME } from "@/styles/themes";
import { useSettingsStore } from "../store";
import { useApplyTheme } from "../useApplyTheme";

describe("configurações", () => {
	beforeEach(() => {
		localStorage.clear();
		delete document.documentElement.dataset.theme;
	});

	it("volta para o tema padrão quando o tema salvo não existe mais", async () => {
		localStorage.setItem(
			"ashtar-settings",
			JSON.stringify({ state: { theme: "tema-que-saiu" }, version: 1 }),
		);

		await useSettingsStore.persist.rehydrate();

		expect(useSettingsStore.getState().theme).toBe(DEFAULT_THEME);
	});

	it("põe o tema escolhido no <html>", () => {
		renderHook(() => useApplyTheme());

		expect(document.documentElement.dataset.theme).toBe("ashtar-dark");
	});
});
