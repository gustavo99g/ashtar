/**
 * Se o seletor de fonte e o painel da transmissão estão abertos, e o último pedido. Um store, e
 * não um estado de componente, porque mais de um lugar abre os dois: o botão Tela da barra da
 * sala, o do painel "Voz conectada", o lugar da própria transmissão na Grade, a bandeja e a ação
 * de um aviso ("Compartilhar outra"), que roda fora da árvore do React. O último pedido serve ao
 * "Tentar de novo" do aviso de áudio.
 */
import { create } from "zustand";
import type { CaptureSource } from "@/lib/tauri/commands";
import type { ScreenShareController, ShareRequest } from "../model/controller";
import { useShareDefaults } from "./shareDefaultsStore";

/** `start`: começa uma transmissão. `change`: troca a fonte da que está no ar. */
export type PickerMode = "start" | "change";

export const usePickerStore = create<{
	open: boolean;
	mode: PickerMode;
	panelOpen: boolean;
	lastRequest: ShareRequest | null;
}>()(() => ({
	open: false,
	mode: "start",
	panelOpen: false,
	lastRequest: null,
}));

export function openSourcePicker(mode: PickerMode = "start"): void {
	usePickerStore.setState({ open: true, mode });
}

export function closeSourcePicker(): void {
	usePickerStore.setState({ open: false });
}

export function openSharePanel(): void {
	usePickerStore.setState({ panelOpen: true });
}

/** Se o painel da transmissão está aberto: quem mede o ping só mede com ele aberto. */
export function useSharePanelOpen(): boolean {
	return usePickerStore((state) => state.panelOpen);
}

export function closeSharePanel(): void {
	usePickerStore.setState({ panelOpen: false });
}

/** Começa o compartilhamento e guarda o pedido. */
export function startShare(
	controller: ScreenShareController,
	request: ShareRequest,
): Promise<void> {
	usePickerStore.setState({ lastRequest: request });
	return controller.start(request);
}

/** Troca a fonte da transmissão no ar; quem assiste não sai da tela. */
export function changeSource(
	controller: ScreenShareController,
	source: CaptureSource,
): Promise<void> {
	return controller.update({ kind: "source", source });
}

/** Religa o áudio da transmissão ativa, o mesmo de antes; o vídeo segue sem parar. */
export async function restartShare(
	controller: ScreenShareController,
): Promise<void> {
	const state = controller.getState();
	if (state.status !== "active") return;
	await controller.update({ kind: "audio", audio: state.audioMode });
}

/**
 * A janela do processo `processId` na lista do seletor: a que não está minimizada, se houver
 * mais de uma (o jogo e o launcher dele, por exemplo).
 */
export function windowOfProcess(
	sources: CaptureSource[],
	processId: number,
): CaptureSource | null {
	const windows = sources.filter(
		(source) =>
			source.source.kind === "window" && source.processId === processId,
	);
	return windows.find((source) => !source.minimized) ?? windows[0] ?? null;
}

/**
 * O pedido do Transmitir do cartão do jogo (ADR 0033, decisão 6): a qualidade, o áudio e o cursor
 * do último início pelo seletor, ou o padrão das configurações.
 */
export function quickShareRequest(source: CaptureSource): ShareRequest {
	const last = usePickerStore.getState().lastRequest;
	const defaults = useShareDefaults.getState();
	const audio = last?.audio.mode ?? defaults.audio;
	return {
		source,
		quality: last?.quality ?? defaults.quality,
		audio:
			audio === "application"
				? source.processId == null
					? { mode: "off" }
					: { mode: "application", processId: source.processId }
				: { mode: audio },
		cursor: last?.cursor ?? true,
		leveler: last?.leveler,
	};
}

/**
 * Transmite a janela do processo `processId` sem abrir o seletor: começa uma transmissão, ou troca
 * a fonte da que está no ar. Devolve `false` se a janela não está na lista.
 */
export async function shareProcessWindow(
	controller: ScreenShareController,
	processId: number,
): Promise<boolean> {
	const source = windowOfProcess(await controller.listSources(), processId);
	if (!source) return false;
	if (controller.getState().status === "active") {
		await changeSource(controller, source);
	} else {
		await startShare(controller, quickShareRequest(source));
	}
	return true;
}
