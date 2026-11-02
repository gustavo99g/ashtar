/**
 * As mensagens que saíram daqui e a API ainda não confirmou: aparecem na conversa na hora, mais
 * apagadas, e viram mensagem de verdade quando a resposta (ou o `message.created`) chega. Se o
 * envio falhar, ficam com "Tentar de novo", que repete com o mesmo `client_id` (a API não
 * duplica). Só na memória: fechar o app esquece o que não foi, e este computador sair do grupo
 * também (`clearOutbox`, chamado pelo `App`), para nada ser mandado com a sessão seguinte.
 */
import { create } from "zustand";

export interface PendingMessage {
	client_id: string;
	channel_id: string;
	body: string;
	/** Em segundos, como o `created_at` da API. */
	created_at: number;
	status: "sending" | "failed";
	/** A mensagem da recusa, no `failed`. */
	error?: string;
}

interface OutboxState {
	pending: PendingMessage[];
}

export const useOutbox = create<OutboxState>()(() => ({ pending: [] }));

export function usePending(channelId: string): PendingMessage[] {
	return useOutbox((state) => state.pending).filter(
		(message) => message.channel_id === channelId,
	);
}

export function addPending(message: PendingMessage): void {
	useOutbox.setState((state) => ({ pending: [...state.pending, message] }));
}

export function updatePending(
	clientId: string,
	change: Partial<PendingMessage>,
): void {
	useOutbox.setState((state) => ({
		pending: state.pending.map((message) =>
			message.client_id === clientId ? { ...message, ...change } : message,
		),
	}));
}

export function removePending(clientId: string): void {
	useOutbox.setState((state) => ({
		pending: state.pending.filter((message) => message.client_id !== clientId),
	}));
}

/** Esquece tudo o que estava saindo. */
export function clearOutbox(): void {
	useOutbox.setState({ pending: [] });
}

export function findPending(clientId: string): PendingMessage | undefined {
	return useOutbox
		.getState()
		.pending.find((message) => message.client_id === clientId);
}
