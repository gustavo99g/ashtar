/**
 * As ordens que a API manda para a voz desta pessoa (ADR 0026): alguém com "Mover membros" a pôs em
 * outra sala (`voice.moved`) ou a tirou da voz (`voice.disconnected`). O tempo real só guarda a
 * ordem aqui; quem cumpre é o `VoiceProvider`, que tem a conexão, e depois limpa.
 */
import { create } from "zustand";

export type VoiceOrder =
	| { kind: "move"; channelId: string; byName: string }
	| { kind: "disconnect"; byName: string; noAccess: boolean };

interface VoiceOrderState {
	order: VoiceOrder | null;
}

export const useVoiceOrder = create<VoiceOrderState>()(() => ({ order: null }));

export function setVoiceOrder(order: VoiceOrder): void {
	useVoiceOrder.setState({ order });
}

export function clearVoiceOrder(): void {
	useVoiceOrder.setState({ order: null });
}
