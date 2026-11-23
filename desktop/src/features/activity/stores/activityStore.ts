/**
 * O jogo do cartão agora (ADR 0033), como o Rust avisa pelo `activity:changed`. Um store porque o
 * cartão, as configurações e os testes leem o mesmo valor.
 */
import { create } from "zustand";
import type { GameView } from "@/lib/tauri/commands";

export const useActivityStore = create<{ game: GameView | null }>()(() => ({
	game: null,
}));

export function setCurrentGame(game: GameView | null): void {
	useActivityStore.setState({ game });
}

/** O jogo aberto agora, ou `null`. */
export function useCurrentGame(): GameView | null {
	return useActivityStore((state) => state.game);
}
