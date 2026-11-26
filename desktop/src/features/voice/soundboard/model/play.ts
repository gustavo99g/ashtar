/**
 * Tocar um som do soundboard (v0.9, ADR 0037): pede à API, que avisa os outros da sala ou da
 * ligação, e toca aqui mesmo, sem esperar o tempo real. A recusa da API (rápido demais, sons
 * bloqueados, fora da sala) vira o aviso do canto.
 */
import { toast } from "@/components/ui/toast";
import {
	markPlaying,
	playSoundFile,
	useSoundboard,
	useSoundsStore,
} from "@/features/sounds";
import { ApiError, playSound, type Sound } from "@/lib/api";

function refusal(error: unknown): string {
	if (error instanceof ApiError && error.kind === "forbidden") {
		return "Um moderador bloqueou seus sons.";
	}
	return error instanceof Error ? error.message : "Tente de novo em instantes.";
}

/** Toca `sound` para a sala. `deafened`: com o áudio desligado, a pessoa não ouve nem o próprio. */
export async function requestPlay(
	sound: Sound,
	me: { userId: string | null; deafened: boolean },
): Promise<boolean> {
	try {
		await playSound(sound.id);
	} catch (error) {
		const tooSoon = error instanceof ApiError && error.kind === "too_many_sounds";
		toast.add({
			title: tooSoon ? "Calma" : "Não deu para tocar o som",
			description: refusal(error),
			data: { tone: tooSoon ? "warning" : "error" },
		});
		return false;
	}
	const prefs = useSoundboard.getState();
	if (prefs.enabled && !me.deafened) {
		void playSoundFile(sound.file_id, prefs.volume / 100);
	}
	if (me.userId) markPlaying(me.userId, sound.duration_ms);
	return true;
}

/** O som do lugar `index`, se o lugar tem um som que ainda existe. */
export function slotSound(index: number): Sound | null {
	const id = useSoundboard.getState().slots[index];
	if (!id) return null;
	return useSoundsStore.getState().sounds.find((sound) => sound.id === id) ?? null;
}
