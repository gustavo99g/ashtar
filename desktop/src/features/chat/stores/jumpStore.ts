/**
 * Ir até uma mensagem de outro lugar (a busca): quem pede guarda o canal e a mensagem e abre o
 * canal; a conversa daquele canal, quando aparece, vai até ela e limpa o pedido.
 */
import { create } from "zustand";

export interface JumpRequest {
	channelId: string;
	messageId: string;
}

export const useJumpStore = create<{ request: JumpRequest | null }>()(() => ({
	request: null,
}));

export function requestJump(channelId: string, messageId: string): void {
	useJumpStore.setState({ request: { channelId, messageId } });
}

export function clearJump(): void {
	useJumpStore.setState({ request: null });
}
