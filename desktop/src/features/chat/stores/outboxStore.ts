/**
 * As mensagens que saíram daqui e a API ainda não confirmou: aparecem na conversa na hora, mais
 * apagadas, e viram mensagem de verdade quando a resposta (ou o `message.created`) chega. Se o
 * envio falhar, ficam com "Tentar de novo", que repete com o mesmo `client_id` (a API não
 * duplica). Só na memória: fechar o app esquece o que não foi, e este computador sair do grupo
 * também (`clearOutbox`, chamado pelo `App`), para nada ser mandado com a sessão seguinte.
 */
import { create } from "zustand";
import { clearDraftFiles } from "./attachmentStore";

/** A mensagem que o envio responde, e se a resposta menciona quem a escreveu (o `@` ligado). */
export interface PendingReply {
	id: string;
	mention: boolean;
}

/** Um anexo saindo: o arquivo daqui, quanto já subiu e, depois de subir, o id na API. */
export interface PendingFile {
	key: string;
	file: File;
	/** De 0 a 1. */
	progress: number;
	/** O id na API, depois de subir: o "Tentar de novo" não sobe de novo. */
	uploaded?: string;
}

export interface PendingMessage {
	client_id: string;
	channel_id: string;
	body: string;
	reply?: PendingReply;
	/** Os anexos, que sobem antes de a mensagem ir. */
	files?: PendingFile[];
	/** Encaminhar: o id da original (o `body` é o texto dela, só para mostrar). */
	forward?: string;
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
	clearDraftFiles();
}

/** Muda o anexo `key` da mensagem `clientId`. */
export function updatePendingFile(
	clientId: string,
	key: string,
	change: Partial<PendingFile>,
): void {
	useOutbox.setState((state) => ({
		pending: state.pending.map((message) =>
			message.client_id === clientId && message.files
				? {
						...message,
						files: message.files.map((file) =>
							file.key === key ? { ...file, ...change } : file,
						),
					}
				: message,
		),
	}));
}

export function findPending(clientId: string): PendingMessage | undefined {
	return useOutbox
		.getState()
		.pending.find((message) => message.client_id === clientId);
}
