/**
 * Os sons da sala (v0.5, ADR 0027): alguém entrou ou saiu, você mutou, desmutou, ficou surdo ou
 * voltou, e alguém começou ou parou de transmitir na sua sala. Tocam na janela principal (quem está
 * na sala está com o app aberto), na saída escolhida em Voz e vídeo, também em Ocupado.
 *
 * Cada um tem a sua chave em Configurações › Notificações. O mesmo som não repete em menos de
 * [`ROOM_SOUND_GAP_MS`]: a sala que abre com cinco pessoas entrando juntas toca uma vez só.
 *
 * Desde a v0.6, o clique do pressionar para falar ([`playPttSound`], fora do intervalo: toca a cada
 * frase) e o volume dos sons de Notificações, que vale para todos.
 */
import deafenSound from "@/assets/sounds/room-deafen.wav";
import joinSound from "@/assets/sounds/room-join.wav";
import leaveSound from "@/assets/sounds/room-leave.wav";
import pttOffSound from "@/assets/sounds/ptt-off.wav";
import pttOnSound from "@/assets/sounds/ptt-on.wav";
import muteSound from "@/assets/sounds/room-mute.wav";
import shareStartSound from "@/assets/sounds/room-share-start.wav";
import shareStopSound from "@/assets/sounds/room-share-stop.wav";
import undeafenSound from "@/assets/sounds/room-undeafen.wav";
import unmuteSound from "@/assets/sounds/room-unmute.wav";
import {
	type RoomSoundId,
	soundVolume,
	useSettingsStore,
} from "@/features/settings";
import { chosenOutput } from "./sound";

export const ROOM_SOUND_GAP_MS = 1500;

const FILES: Record<RoomSoundId, string> = {
	join: joinSound,
	leave: leaveSound,
	mute: muteSound,
	unmute: unmuteSound,
	deafen: deafenSound,
	undeafen: undeafenSound,
	shareStart: shareStartSound,
	shareStop: shareStopSound,
	ptt: pttOnSound,
};

const lastPlayed = new Map<RoomSoundId, number>();

/** Toca o arquivo na saída escolhida. Falhar (sem saída, sem permissão) é silêncio. */
function play(url: string): void {
	const audio = new Audio(url) as HTMLAudioElement & {
		setSinkId?: (id: string) => Promise<void>;
	};
	audio.volume = soundVolume();
	const output = chosenOutput();
	const ready =
		output && audio.setSinkId
			? audio.setSinkId(output).catch(() => {})
			: Promise.resolve();
	void ready.then(() => audio.play()).catch(() => {});
}

/**
 * Toca o som `id`, se a chave dele está ligada e ele não acabou de tocar. `force` é o botão de
 * testar: toca mesmo com a chave desligada. `gap: false` toca mesmo tendo acabado de tocar: o mute
 * e o surdo vêm de um clique da própria pessoa, e cada um tem o seu som.
 */
export function playRoomSound(
	id: RoomSoundId,
	{ now = Date.now(), force = false, gap = true } = {},
): boolean {
	if (!force && !useSettingsStore.getState().roomSounds[id]) return false;
	const last = lastPlayed.get(id);
	if (!force && gap && last !== undefined && now - last < ROOM_SOUND_GAP_MS) {
		return false;
	}
	lastPlayed.set(id, now);
	play(FILES[id]);
	return true;
}

/** O clique do pressionar para falar: ao abrir (`open`) e ao fechar o microfone pelo atalho. */
export function playPttSound(open: boolean): void {
	if (!useSettingsStore.getState().roomSounds.ptt) return;
	play(open ? pttOnSound : pttOffSound);
}

/** Para os testes: esquece quando cada som tocou. */
export function resetRoomSounds(): void {
	lastPlayed.clear();
}
