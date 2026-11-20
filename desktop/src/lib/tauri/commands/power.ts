/**
 * O Windows voltando da suspensão (ADR 0030): o Rust avisa (`power.rs`), e a voz entra de novo na
 * hora.
 */
import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Escuta a volta da suspensão; devolve quem para de escutar. Fora do app, nunca chama. */
export function onSystemResumed(callback: () => void): () => void {
	if (!isTauri()) return () => {};
	let alive = true;
	let unlisten: UnlistenFn | null = null;
	void listen("system-resumed", () => callback()).then((off) => {
		if (alive) unlisten = off;
		else off();
	});
	return () => {
		alive = false;
		unlisten?.();
	};
}
