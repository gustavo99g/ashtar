/**
 * Os sons do grupo (v0.9, ADR 0037): os aprovados, que a grade mostra, o tamanho da fila de
 * aprovação (o contador dourado) e quem está tocando um som agora (a onda dourada na lista e no
 * bloco). Os aprovados vêm do `GET /api/sounds` ao entrar e depois do `sounds.changed`.
 */
import { create } from "zustand";
import type { Sound } from "@/lib/api";

interface SoundsState {
	sounds: Sound[];
	pending: number;
	/** Quem está tocando um som, com até quando (`Date.now()`). */
	playing: Record<string, number>;
}

export const useSoundsStore = create<SoundsState>()(() => ({
	sounds: [],
	pending: 0,
	playing: {},
}));

export function setSounds(sounds: Sound[]): void {
	useSoundsStore.setState({ sounds });
}

export function setPendingSounds(pending: number): void {
	useSoundsStore.setState({ pending });
}

export function clearSounds(): void {
	useSoundsStore.setState({ sounds: [], pending: 0, playing: {} });
}

/** Os aprovados, por nome. */
export function useSounds(): Sound[] {
	return useSoundsStore((state) => state.sounds);
}

export function usePendingSounds(): number {
	return useSoundsStore((state) => state.pending);
}

/** A onda dura o som e mais um pouco, para não piscar num som curto. */
const MIN_WAVE_MS = 900;

/** `userId` está tocando um som de `durationMs`: a onda aparece e some sozinha no fim. */
export function markPlaying(
	userId: string,
	durationMs: number,
	now = Date.now(),
): void {
	const until = now + Math.max(durationMs, MIN_WAVE_MS);
	useSoundsStore.setState((state) => ({
		playing: { ...state.playing, [userId]: until },
	}));
	setTimeout(() => {
		useSoundsStore.setState((state) => {
			if (state.playing[userId] !== until) return state;
			const playing = { ...state.playing };
			delete playing[userId];
			return { playing };
		});
	}, until - now);
}

/** Se `userId` está tocando um som agora. */
export function useSoundPlaying(userId: string): boolean {
	return useSoundsStore((state) => state.playing[userId] !== undefined);
}
