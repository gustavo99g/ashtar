/**
 * Se o seletor de fonte está aberto, e o último pedido que ele fez. Um store, e não um estado de
 * componente, porque mais de um lugar abre o mesmo seletor: o botão Tela da barra da sala, o do
 * painel "Voz conectada" e a ação de um aviso ("Compartilhar outra"), que roda fora da árvore do
 * React. O último pedido serve ao "Tentar de novo" do aviso de áudio.
 */
import { create } from "zustand";
import type { ScreenShareController, ShareRequest } from "../model/controller";

export const usePickerStore = create<{
	open: boolean;
	lastRequest: ShareRequest | null;
}>()(() => ({ open: false, lastRequest: null }));

export function openSourcePicker(): void {
	usePickerStore.setState({ open: true });
}

export function closeSourcePicker(): void {
	usePickerStore.setState({ open: false });
}

/** Começa o compartilhamento e guarda o pedido. */
export function startShare(
	controller: ScreenShareController,
	request: ShareRequest,
): Promise<void> {
	usePickerStore.setState({ lastRequest: request });
	return controller.start(request);
}

/**
 * Recomeça o compartilhamento ativo com o mesmo pedido: a captura do áudio começa de novo junto
 * com a do vídeo, porque o controller não tem como religar só o áudio.
 */
export async function restartShare(
	controller: ScreenShareController,
): Promise<void> {
	const request = usePickerStore.getState().lastRequest;
	const state = controller.getState();
	if (!request || state.status !== "active") return;
	if (state.source.source.kind !== request.source.source.kind) return;
	if (state.source.source.id !== request.source.source.id) return;
	await controller.stop();
	await controller.start(request);
}
