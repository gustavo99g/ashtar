/**
 * Como a sala está sendo vista: em Grade ou no Foco, assistindo a transmissão de alguém. Fica num
 * store para sobreviver à ida às configurações (a rota da sala desmonta embaixo delas) e para
 * quem está fora da sala (a tela do servidor, um aviso) abrir a sala já assistindo.
 */
import { create } from "zustand";

interface RoomViewState {
	/** A identidade de quem está sendo assistido; `null` é a Grade. */
	watching: string | null;
	/**
	 * De quem é a transmissão desenhada no Foco agora: o `ScreenStage` marca ao aparecer e desmarca
	 * ao sair. Só essa tela é baixada (`subscriptions.ts`).
	 */
	onStage: string | null;
}

export const useRoomView = create<RoomViewState>()(() => ({
	watching: null,
	onStage: null,
}));

/** Abre o Foco na transmissão de `identity`. */
export function watchShare(identity: string): void {
	useRoomView.setState({ watching: identity });
}

/** Volta para a Grade. */
export function stopWatching(): void {
	useRoomView.setState({ watching: null });
}

/** O palco do Foco mostra a transmissão de `identity` (`null`: não mostra nenhuma). */
export function setOnStage(identity: string | null): void {
	useRoomView.setState({ onStage: identity });
}
