/**
 * O padrão do seletor de fontes (Configurações › Voz e vídeo › Compartilhamento de tela, ADR 0029):
 * a qualidade e o áudio com que o seletor abre, e se o vídeo é codificado na placa. Guardado neste
 * computador.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AudioMode, Quality } from "@/lib/tauri/commands";
import { DEFAULT_QUALITY, QUALITY_ORDER } from "../model/presets";

export type ShareAudioChoice = AudioMode["mode"];

export interface ShareDefaults {
	quality: Quality;
	audio: ShareAudioChoice;
	/** Codificar o vídeo na placa (v0.7). Desligado, vai pela CPU: para comparar o jogo aberto junto. */
	hardwareEncoder: boolean;
}

export const DEFAULT_SHARE: ShareDefaults = {
	quality: DEFAULT_QUALITY,
	audio: "application",
	hardwareEncoder: true,
};

const AUDIO: readonly ShareAudioChoice[] = ["off", "application", "system"];

export function readShareDefaults(saved: unknown): ShareDefaults {
	const value = (saved ?? {}) as Partial<Record<keyof ShareDefaults, unknown>>;
	return {
		quality: QUALITY_ORDER.includes(value.quality as Quality)
			? (value.quality as Quality)
			: DEFAULT_SHARE.quality,
		audio: AUDIO.includes(value.audio as ShareAudioChoice)
			? (value.audio as ShareAudioChoice)
			: DEFAULT_SHARE.audio,
		hardwareEncoder:
			typeof value.hardwareEncoder === "boolean"
				? value.hardwareEncoder
				: DEFAULT_SHARE.hardwareEncoder,
	};
}

export const useShareDefaults = create<ShareDefaults>()(
	persist((): ShareDefaults => DEFAULT_SHARE, {
		name: "ashtar-share-defaults",
		version: 1,
		merge: (persisted, current) => ({
			...current,
			...readShareDefaults(persisted),
		}),
	}),
);

export function setShareDefaults(patch: Partial<ShareDefaults>): void {
	useShareDefaults.setState(
		readShareDefaults({ ...useShareDefaults.getState(), ...patch }),
	);
}

/**
 * O áudio com que uma aba do seletor começa. Uma tela inteira não tem aplicativo: o padrão "Só do
 * aplicativo" vira "Todo o sistema" nela.
 */
export function initialShareAudio(
	audio: ShareAudioChoice,
	tab: "windows" | "screens",
): ShareAudioChoice {
	return tab === "screens" && audio === "application" ? "system" : audio;
}
