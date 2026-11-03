/**
 * Como a sala está sendo vista: em Grade ou no Foco, assistindo a transmissão de alguém. Fica num
 * store para sobreviver à ida às configurações (a rota da sala desmonta embaixo delas) e para
 * quem está fora da sala (a tela do servidor, um aviso) abrir a sala já assistindo.
 *
 * Desde a 0.2.3, quem assiste no Foco e sai da sala continua assistindo na miniatura
 * (`MiniShare`), por cima do canal de texto.
 */
import { create } from "zustand";

interface RoomViewState {
	/** A identidade de quem está sendo assistido; `null` é a Grade. */
	watching: string | null;
	/**
	 * De quem é a transmissão desenhada agora, no palco do Foco ou na miniatura: quem desenha marca
	 * ao aparecer e desmarca ao sair. Só essa tela é baixada (`subscriptions.ts`). Nas
	 * configurações, nenhuma das duas aparece, e nada é baixado.
	 */
	shown: string | null;
}

export const useRoomView = create<RoomViewState>()(() => ({
	watching: null,
	shown: null,
}));

/** Abre o Foco na transmissão de `identity`. */
export function watchShare(identity: string): void {
	useRoomView.setState({ watching: identity });
}

/** Volta para a Grade (e fecha a miniatura). */
export function stopWatching(): void {
	useRoomView.setState({ watching: null });
}

/** A transmissão de `identity` aparece na tela (`null`: nenhuma aparece). */
export function setShown(identity: string | null): void {
	useRoomView.setState({ shown: identity });
}
