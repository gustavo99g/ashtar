import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_THEME } from "@/styles/themes";
import { DEFAULT_NOTIFICATIONS, useSettingsStore } from "../stores/settingsStore";
import { useApplyTheme } from "../hooks/useApplyTheme";

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

describe("as chaves de notificação", () => {
	beforeEach(() => localStorage.clear());

	it("quem vem de antes delas fica com todas ligadas", async () => {
		localStorage.setItem(
			"ashtar-settings",
			JSON.stringify({ state: { theme: "ashtar-dark" }, version: 1 }),
		);
		await useSettingsStore.persist.rehydrate();
		expect(useSettingsStore.getState().notifications).toEqual(DEFAULT_NOTIFICATIONS);
	});

	it("guarda o que foi desligado, e um valor estranho volta para o padrão", async () => {
		localStorage.setItem(
			"ashtar-settings",
			JSON.stringify({
				state: { theme: "ashtar-dark", notifications: { dms: false, sounds: "sim" } },
				version: 1,
			}),
		);
		await useSettingsStore.persist.rehydrate();
		expect(useSettingsStore.getState().notifications).toEqual({
			...DEFAULT_NOTIFICATIONS,
			dms: false,
		});
	});
});
