/**
 * Os atalhos deste computador (ADR 0029, decisão 8), no `localStorage` como os dispositivos. O app
 * manda a lista para o Rust ao abrir e a cada mudança (`GlobalShortcuts`).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
	DEFAULT_SHORTCUTS,
	readShortcuts,
	type Shortcut,
	type ShortcutId,
	type Shortcuts,
} from "../model/shortcuts";

export const useShortcuts = create<Shortcuts>()(
	persist((): Shortcuts => DEFAULT_SHORTCUTS, {
		name: "ashtar-shortcuts",
		version: 1,
		merge: (persisted, current) => ({ ...current, ...readShortcuts(persisted) }),
	}),
);

/** Define (ou tira, com `null`) o atalho `id`. */
export function setShortcut(id: ShortcutId, shortcut: Shortcut | null): void {
	useShortcuts.setState({ [id]: shortcut });
}

export function restoreShortcuts(): void {
	useShortcuts.setState(DEFAULT_SHORTCUTS);
}
