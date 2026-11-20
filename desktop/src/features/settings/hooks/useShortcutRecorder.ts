import { useEffect, useState } from "react";
import { onShortcutRecorded, recordShortcuts } from "@/lib/tauri/commands";
import { isEscape, type ShortcutId, usedBy } from "../model/shortcuts";
import { setShortcut, useShortcuts } from "../stores/shortcutStore";

/**
 * Gravar um atalho (ADR 0029, decisão 7): `start` põe a linha gravando, e a próxima combinação
 * apertada (vinda do gancho do Rust, que vê também o teclado com o Ashtar em foco) vira o atalho.
 * Esc ou `cancel` desiste. Enquanto grava, nenhum atalho dispara (o Rust cuida) e as teclas não
 * fazem nada no app (o Esc não fecha as configurações). Uma combinação que outra linha já usa não
 * entra: `conflict` diz quem usa, e a linha continua gravando.
 */
export function useShortcutRecorder(): {
	recording: ShortcutId | null;
	conflict: ShortcutId | null;
	start: (id: ShortcutId) => void;
	cancel: () => void;
} {
	const [recording, setRecording] = useState<ShortcutId | null>(null);
	const [conflict, setConflict] = useState<ShortcutId | null>(null);

	useEffect(() => {
		if (!recording) return;
		let alive = true;
		let unlisten: (() => void) | null = null;
		const stop = () => {
			setRecording(null);
			setConflict(null);
		};
		void onShortcutRecorded(({ combo, label }) => {
			if (!alive) return;
			if (isEscape(combo)) {
				stop();
				return;
			}
			const other = usedBy(useShortcuts.getState(), combo, recording);
			if (other) {
				setConflict(other);
				return;
			}
			setShortcut(recording, { combo, label });
			stop();
		}).then((off) => {
			if (alive) unlisten = off;
			else off();
		});
		void recordShortcuts(true).catch(() => {});

		// As teclas não chegam ao app enquanto grava; o Esc desiste também por aqui.
		const onKeyDown = (event: KeyboardEvent) => {
			event.preventDefault();
			event.stopPropagation();
			if (event.key === "Escape") stop();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			alive = false;
			unlisten?.();
			window.removeEventListener("keydown", onKeyDown, true);
			void recordShortcuts(false).catch(() => {});
		};
	}, [recording]);

	return {
		recording,
		conflict,
		start: (id) => {
			setConflict(null);
			setRecording(id);
		},
		cancel: () => {
			setConflict(null);
			setRecording(null);
		},
	};
}
