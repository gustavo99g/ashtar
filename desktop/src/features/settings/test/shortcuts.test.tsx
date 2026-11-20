import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordedShortcut } from "@/lib/tauri/commands";
import { ShortcutsSettings } from "../components/ShortcutsSettings";
import {
	DEFAULT_SHORTCUTS,
	labelKeys,
	readShortcuts,
	usedBy,
} from "../model/shortcuts";
import { useShortcuts } from "../stores/shortcutStore";

let recorded: ((shortcut: RecordedShortcut) => void) | null = null;
const recordShortcuts = vi.fn<(recording: boolean) => Promise<void>>(
	async () => {},
);

vi.mock("@/lib/tauri/commands", () => ({
	recordShortcuts: (recording: boolean) => recordShortcuts(recording),
	onShortcutRecorded: async (callback: (shortcut: RecordedShortcut) => void) => {
		recorded = callback;
		return () => {
			recorded = null;
		};
	},
}));

const NONE = { ctrl: false, shift: false, alt: false, win: false };
const V = { ...NONE, key: 0x56, mouse: null };
const MOUSE_4 = { ...NONE, key: null, mouse: "x1" as const };
const ESC = { ...NONE, key: 0x1b, mouse: null };

function press(shortcut: RecordedShortcut) {
	act(() => recorded?.(shortcut));
}

beforeEach(() => {
	localStorage.clear();
	useShortcuts.setState(DEFAULT_SHORTCUTS);
	recorded = null;
	recordShortcuts.mockClear();
});

describe("as combinações", () => {
	it("o nome vira uma caixinha por tecla, e o + sozinho fica", () => {
		expect(labelKeys("Ctrl+Shift+M")).toEqual(["Ctrl", "Shift", "M"]);
		expect(labelKeys("Ctrl++")).toEqual(["Ctrl", "+"]);
		expect(labelKeys("Mouse 4")).toEqual(["Mouse 4"]);
	});

	it("quem já usa uma combinação", () => {
		expect(
			usedBy(DEFAULT_SHORTCUTS, DEFAULT_SHORTCUTS.mute!.combo, "deafen"),
		).toBe("mute");
		expect(
			usedBy(DEFAULT_SHORTCUTS, DEFAULT_SHORTCUTS.mute!.combo, "mute"),
		).toBeNull();
	});

	it("do disco: o que nunca foi mexido é o padrão, o estranho vira nenhum", () => {
		const read = readShortcuts({
			ptt: { combo: MOUSE_4, label: "Mouse 4" },
			mute: { combo: { ...NONE, key: null, mouse: null }, label: "?" },
			deafen: null,
		});
		expect(read.ptt).toEqual({ combo: MOUSE_4, label: "Mouse 4" });
		expect(read.mute).toBeNull();
		expect(read.deafen).toBeNull();
		expect(read.answer).toEqual(DEFAULT_SHORTCUTS.answer);
	});
});

describe("Configurações › Atalhos", () => {
	it("mostra os padrões, e o pressionar para falar sem atalho", () => {
		render(<ShortcutsSettings />);
		expect(screen.getByLabelText("Ctrl+Shift+M")).toBeInTheDocument();
		expect(
			screen.getByRole("button", {
				name: "Definir atalho de Pressionar para falar",
			}),
		).toBeInTheDocument();
	});

	it("gravar: a próxima combinação vira o atalho, e o gancho para de gravar", async () => {
		const user = userEvent.setup();
		render(<ShortcutsSettings />);

		await user.click(
			screen.getByRole("button", {
				name: "Definir atalho de Pressionar para falar",
			}),
		);
		expect(recordShortcuts).toHaveBeenLastCalledWith(true);
		expect(screen.getByText("Aperte a combinação…")).toBeInTheDocument();

		press({ combo: MOUSE_4, label: "Mouse 4" });

		expect(useShortcuts.getState().ptt).toEqual({
			combo: MOUSE_4,
			label: "Mouse 4",
		});
		expect(recordShortcuts).toHaveBeenLastCalledWith(false);
		expect(screen.getByLabelText("Mouse 4")).toBeInTheDocument();
	});

	it("a combinação de outra linha não entra: diz quem usa e continua gravando", async () => {
		const user = userEvent.setup();
		render(<ShortcutsSettings />);
		await user.click(
			screen.getByRole("button", {
				name: "Definir atalho de Pressionar para falar",
			}),
		);

		press({ combo: DEFAULT_SHORTCUTS.mute!.combo, label: "Ctrl+Shift+M" });

		expect(screen.getByRole("alert")).toHaveTextContent(
			"Já é o atalho de Desativar microfone",
		);
		expect(useShortcuts.getState().ptt).toBeNull();
		press({ combo: V, label: "V" });
		expect(useShortcuts.getState().ptt?.label).toBe("V");
	});

	it("Esc desiste sem mudar nada, e não fecha as configurações", async () => {
		const user = userEvent.setup();
		const closed = vi.fn();
		window.addEventListener("keydown", closed);
		render(<ShortcutsSettings />);
		await user.click(
			screen.getByRole("button", {
				name: "Trocar atalho de Desativar microfone",
			}),
		);

		await user.keyboard("{Escape}");
		press({ combo: ESC, label: "Esc" });

		expect(closed).not.toHaveBeenCalled();
		expect(useShortcuts.getState().mute).toEqual(DEFAULT_SHORTCUTS.mute);
		expect(screen.queryByText("Aperte a combinação…")).not.toBeInTheDocument();
		window.removeEventListener("keydown", closed);
	});

	it("o X tira o atalho, e Restaurar padrões volta tudo", async () => {
		const user = userEvent.setup();
		render(<ShortcutsSettings />);

		await user.click(
			screen.getByRole("button", {
				name: "Remover atalho de Desativar áudio",
			}),
		);
		expect(useShortcuts.getState().deafen).toBeNull();

		await user.click(screen.getByRole("button", { name: "Restaurar padrões" }));
		expect(useShortcuts.getState()).toMatchObject(DEFAULT_SHORTCUTS);
	});
});
