/**
 * Os arquivos escolhidos para a próxima mensagem de cada canal, antes de enviar: os cartões em
 * cima do campo. Só na memória, como os arquivos (um `File` não vai para o disco). Trocar de canal
 * e voltar traz de volta, como o rascunho do texto.
 */
import { create } from "zustand";
import { attachProblem } from "../model/attachments";

export interface DraftFile {
	key: string;
	file: File;
}

interface AttachmentState {
	byChannel: Record<string, DraftFile[]>;
}

const NONE: DraftFile[] = [];

export const useAttachments = create<AttachmentState>(() => ({
	byChannel: {},
}));

export function useDraftFiles(channelId: string): DraftFile[] {
	return useAttachments((state) => state.byChannel[channelId] ?? NONE);
}

/** Acrescenta `files` aos de `channelId`. Devolve o motivo se não couber (e não acrescenta nada). */
export function addDraftFiles(
	channelId: string,
	files: readonly File[],
): string | null {
	const current = useAttachments.getState().byChannel[channelId] ?? NONE;
	const problem = attachProblem(current.length, files);
	if (problem) return problem;
	const added = files.map((file) => ({ key: crypto.randomUUID(), file }));
	useAttachments.setState((state) => ({
		byChannel: { ...state.byChannel, [channelId]: [...current, ...added] },
	}));
	return null;
}

export function removeDraftFile(channelId: string, key: string): void {
	useAttachments.setState((state) => ({
		byChannel: {
			...state.byChannel,
			[channelId]: (state.byChannel[channelId] ?? NONE).filter(
				(draft) => draft.key !== key,
			),
		},
	}));
}

/** Tira e devolve os arquivos de `channelId` (o envio leva). */
export function takeDraftFiles(channelId: string): DraftFile[] {
	const files = useAttachments.getState().byChannel[channelId] ?? NONE;
	if (files.length > 0) {
		useAttachments.setState((state) => {
			const rest = { ...state.byChannel };
			delete rest[channelId];
			return { byChannel: rest };
		});
	}
	return files;
}

export function clearDraftFiles(): void {
	useAttachments.setState({ byChannel: {} });
}
