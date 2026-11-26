/**
 * O soundboard deste computador (v0.9, ADR 0037): a chave geral e o volume dos sons dos outros
 * (Configurações › Notificações) e os 4 lugares da grade, cada um com um atalho global. Ficam no
 * `localStorage`, como os atalhos.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const SLOT_COUNT = 4;

/** O volume padrão, em %: mais baixo que os sons do app, porque o som é de outra pessoa. */
export const DEFAULT_SOUNDBOARD_VOLUME = 60;

export interface SoundboardPrefs {
	/** Ouvir os sons do soundboard. Desligado, nenhum toca (nem os seus). */
	enabled: boolean;
	/** De 0 a 100 (%). */
	volume: number;
	/** O id do som em cada lugar, ou `null`. */
	slots: (string | null)[];
}

export const DEFAULT_SOUNDBOARD: SoundboardPrefs = {
	enabled: true,
	volume: DEFAULT_SOUNDBOARD_VOLUME,
	slots: [null, null, null, null],
};

/** Lê do disco: um valor estranho vira o padrão. */
export function readSoundboard(saved: unknown): SoundboardPrefs {
	const value = (
		typeof saved === "object" && saved !== null ? saved : {}
	) as Record<string, unknown>;
	const volume =
		typeof value.volume === "number" && Number.isFinite(value.volume)
			? Math.min(100, Math.max(0, value.volume))
			: DEFAULT_SOUNDBOARD_VOLUME;
	const savedSlots = Array.isArray(value.slots) ? value.slots : [];
	const slots = Array.from({ length: SLOT_COUNT }, (_, i) =>
		typeof savedSlots[i] === "string" && savedSlots[i] !== ""
			? (savedSlots[i] as string)
			: null,
	);
	return {
		enabled: typeof value.enabled === "boolean" ? value.enabled : true,
		volume,
		slots,
	};
}

export const useSoundboard = create<SoundboardPrefs>()(
	persist((): SoundboardPrefs => DEFAULT_SOUNDBOARD, {
		name: "ashtar-soundboard",
		version: 1,
		merge: (persisted, current) => ({
			...current,
			...readSoundboard(persisted),
		}),
	}),
);

export function setSoundboardEnabled(enabled: boolean): void {
	useSoundboard.setState({ enabled });
}

export function setSoundboardVolume(volume: number): void {
	useSoundboard.setState({ volume: Math.min(100, Math.max(0, volume)) });
}

/**
 * Põe o som `soundId` no lugar `index` (de 0 a 3). Se ele já estava em outro lugar, sai de lá: um
 * som ocupa um lugar só.
 */
export function setSlot(index: number, soundId: string | null): void {
	if (index < 0 || index >= SLOT_COUNT) return;
	useSoundboard.setState((state) => {
		const slots = state.slots.map((id) =>
			soundId !== null && id === soundId ? null : id,
		);
		slots[index] = soundId;
		return { slots };
	});
}
