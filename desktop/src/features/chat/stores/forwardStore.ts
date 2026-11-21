/**
 * A mensagem que a pessoa pediu para encaminhar (o Encaminhar do menu). Quem abre a janela de
 * escolher o destino é a `features/forward`, que vê esta store: o chat não conhece a lista de
 * conversas.
 */
import { create } from "zustand";
import type { Message } from "@/lib/api";

export const useForwardRequest = create<{ message: Message | null }>(() => ({
	message: null,
}));

export function requestForward(message: Message): void {
	useForwardRequest.setState({ message });
}

export function closeForward(): void {
	useForwardRequest.setState({ message: null });
}
