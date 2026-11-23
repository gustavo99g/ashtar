import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ActivitySettingsView, CaptureSource } from "@/lib/tauri/commands";
import {
	activitySettings,
	removeGame,
	setActivityEnabled,
	setGameHidden,
} from "@/lib/tauri/commands";
import { ActivitySettings } from "../components/ActivitySettings";
import { windowChoices } from "../components/AddGameDialog";
import { lastSeenLabel, playTime } from "../model/playTime";

vi.mock("@/lib/tauri/commands", async (importOriginal) => ({
	...(await importOriginal<object>()),
	activitySettings: vi.fn(),
	setActivityEnabled: vi.fn(async () => {}),
	setGameHidden: vi.fn(async () => {}),
	removeGame: vi.fn(async () => {}),
}));

const SETTINGS: ActivitySettingsView = {
	enabled: true,
	seen: [
		{
			id: "hades",
			name: "Hades",
			exe: String.raw`C:\Hades\Hades.exe`,
			source: "steam",
			lastSeen: Date.now(),
			hidden: false,
			icon: null,
		},
		{
			id: "meu",
			name: "Meu jogo",
			exe: String.raw`D:\Meu\jogo.exe`,
			source: "manual",
			lastSeen: Date.now(),
			hidden: true,
			icon: null,
		},
	],
	manual: [
		{ exe: String.raw`D:\Meu\jogo.exe`, name: "Meu jogo" },
		{ exe: String.raw`E:\Novo\novo.exe`, name: "Novo" },
	],
};

function renderSettings() {
	vi.mocked(activitySettings).mockResolvedValue(SETTINGS);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<ActivitySettings />
		</QueryClientProvider>,
	);
}

describe("tempo de jogo", () => {
	it("conta desde que o processo abriu", () => {
		const now = 10 * 3_600_000;
		expect(playTime(now - 20_000, now)).toBe("agora");
		expect(playTime(now - 12 * 60_000, now)).toBe("há 12 min");
		expect(playTime(now - 60 * 60_000, now)).toBe("há 1 h");
		expect(playTime(now - 65 * 60_000, now)).toBe("há 1 h 05 min");
	});

	it("a última vez, pelo dia", () => {
		const now = new Date(2026, 10, 22, 20, 0).getTime();
		expect(lastSeenLabel(new Date(2026, 10, 22, 1, 0).getTime(), now)).toBe(
			"hoje",
		);
		expect(lastSeenLabel(new Date(2026, 10, 21, 23, 0).getTime(), now)).toBe(
			"ontem",
		);
		expect(lastSeenLabel(new Date(2026, 10, 19).getTime(), now)).toBe(
			"há 3 dias",
		);
		expect(lastSeenLabel(new Date(2026, 9, 2).getTime(), now)).toBe("02/10");
	});
});

describe("Adicionar jogo", () => {
	it("só as janelas com .exe, e as reconhecidas marcadas", () => {
		const window = (id: number, title: string): CaptureSource => ({
			source: { kind: "window", id },
			title,
			processId: id,
			icon: null,
			monitor: null,
			minimized: false,
		});
		const choices = windowChoices(
			[
				window(1, "Hades"),
				window(2, "Sem exe"),
				window(3, "Bloco de notas"),
				{ ...window(4, "Tela"), source: { kind: "monitor", id: 4 } },
			],
			[
				{ id: 1, exe: String.raw`C:\Hades.exe`, recognized: "Hades" },
				{ id: 2, exe: null, recognized: null },
				{ id: 3, exe: String.raw`C:\notepad.exe`, recognized: null },
			],
		);
		expect(choices.map((choice) => [choice.title, choice.recognized])).toEqual([
			["Hades", "Hades"],
			["Bloco de notas", null],
		]);
	});
});

describe("Configurações › Atividade", () => {
	it("lista os jogos reconhecidos e os adicionados que ainda não abriram", async () => {
		renderSettings();
		expect(await screen.findByText("Hades")).toBeInTheDocument();
		expect(screen.getByText("Meu jogo")).toBeInTheDocument();
		expect(screen.getByText("Novo")).toBeInTheDocument();
		expect(screen.getByText("Adicionado, ainda não abriu")).toBeInTheDocument();
		// Só os adicionados têm o X.
		expect(screen.getByRole("button", { name: "Tirar Meu jogo" })).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Tirar Hades" }),
		).not.toBeInTheDocument();
	});

	it("a chave de cada jogo esconde e mostra", async () => {
		renderSettings();
		await userEvent.click(
			await screen.findByRole("switch", { name: "Mostrar Hades" }),
		);
		expect(setGameHidden).toHaveBeenCalledWith("hades", true);
		await userEvent.click(screen.getByRole("switch", { name: "Mostrar Meu jogo" }));
		expect(setGameHidden).toHaveBeenCalledWith("meu", false);
	});

	it("a chave geral liga e desliga o reconhecimento", async () => {
		renderSettings();
		await screen.findByText("Hades");
		const [general] = screen.getAllByRole("switch");
		await userEvent.click(general);
		await waitFor(() => expect(setActivityEnabled).toHaveBeenCalledWith(false));
	});

	it("o X tira o jogo adicionado", async () => {
		renderSettings();
		await userEvent.click(
			await screen.findByRole("button", { name: "Tirar Novo" }),
		);
		expect(removeGame).toHaveBeenCalledWith(String.raw`E:\Novo\novo.exe`);
	});
});
