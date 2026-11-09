/**
 * Quem está assistindo a própria transmissão, pelo nome e desde quando. Quem sabe é a sala de voz
 * (`voice/room/hooks/useShareViewers`), que escreve aqui; o popover e o painel da transmissão
 * leem. Vazio fora de uma transmissão.
 */
import { create } from "zustand";

export interface ShareViewer {
	id: string;
	name: string;
	/** Quando o aviso de que começou a assistir chegou (`Date.now()`). */
	since: number;
}

interface ViewersState {
	viewers: readonly ShareViewer[];
}

export const useShareViewerList = create<ViewersState>()(() => ({
	viewers: [],
}));

export function setShareViewers(viewers: readonly ShareViewer[]): void {
	useShareViewerList.setState({ viewers });
}
