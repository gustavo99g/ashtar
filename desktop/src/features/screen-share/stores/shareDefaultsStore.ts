/**
 * O padrão do seletor de fontes (Configurações › Voz e vídeo › Compartilhamento de tela, ADR 0029):
 * a qualidade e o áudio com que o seletor abre. Guardado neste computador.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AudioMode, Quality } from "@/lib/tauri/commands";
import { DEFAULT_QUALITY, QUALITY_ORDER } from "../model/presets";

export type ShareAudioChoice = AudioMode["mode"];

export interface ShareDefaults {
	quality: Quality;
	audio: ShareAudioChoice;
}

export const DEFAULT_SHARE: ShareDefaults = {
	quality: DEFAULT_QUALITY,
	audio: "application",
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
