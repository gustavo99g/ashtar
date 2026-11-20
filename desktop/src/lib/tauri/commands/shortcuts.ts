/**
 * Os atalhos globais (ADR 0029): o gancho do Windows no Rust (`shortcuts/`) avisa "apertou" e
 * "soltou"; quem decide o que fazer é o app. Espelha `commands/shortcuts.rs`.
 */
import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { call } from "./core";

/** A combinação, no formato do Rust (`shortcuts/combo.rs`). */
export interface ShortcutCombo {
	ctrl: boolean;
	shift: boolean;
	alt: boolean;
	win: boolean;
	key: number | null;
	mouse: "middle" | "x1" | "x2" | null;
}

export interface ShortcutBinding {
	id: string;
	combo: ShortcutCombo;
}

export interface ShortcutEvent {
	id: string;
	pressed: boolean;
}

export interface RecordedShortcut {
	combo: ShortcutCombo;
	/** O nome que o Windows dá à combinação, no teclado de agora ("Ctrl+Shift+Ç"). */
	label: string;
}

/** Troca a lista de atalhos que o gancho ouve. Fora do app (o navegador), não faz nada. */
export async function setShortcuts(bindings: ShortcutBinding[]): Promise<void> {
	if (!isTauri()) return;
	await call<void>("shortcuts_set", { bindings });
}

/** Gravando, nenhum atalho dispara e cada combinação apertada chega por [`onShortcutRecorded`]. */
export async function recordShortcuts(recording: boolean): Promise<void> {
	if (!isTauri()) return;
	await call<void>("shortcuts_record", { recording });
}

/** O que a janela viu em foco: uma tecla (código virtual do Windows) ou um botão do mouse. */
export type WindowInput =
	| { key: number; mouse: null }
	| { key: null; mouse: "middle" | "x1" | "x2" };

/**
 * Com o Ashtar em foco, o gancho do Windows não recebe as teclas: a janela manda as que vê, e o
 * Rust trata como as do gancho (atalhos e gravação).
 */
export async function shortcutInput(
	input: WindowInput,
	down: boolean,
): Promise<void> {
	if (!isTauri()) return;
	await call<void>("shortcuts_input", { ...input, down });
}

export function onShortcut(
	callback: (event: ShortcutEvent) => void,
): Promise<UnlistenFn> {
	if (!isTauri()) return Promise.resolve(() => {});
	return listen<ShortcutEvent>("shortcut", (event) => callback(event.payload));
}

export function onShortcutRecorded(
	callback: (recorded: RecordedShortcut) => void,
): Promise<UnlistenFn> {
	if (!isTauri()) return Promise.resolve(() => {});
	return listen<RecordedShortcut>("shortcut-recorded", (event) =>
		callback(event.payload),
	);
}
