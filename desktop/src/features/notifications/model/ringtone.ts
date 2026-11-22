/**
 * O toque da ligação recebida, em repetição enquanto o cartão está na tela. Toca na janela dos
 * avisos, que está à vista nessa hora (ADR 0023), pela saída escolhida em Voz e vídeo. Não passa
 * pelo intervalo dos outros sons: é um som só, que para quando o cartão sai.
 */
import ringSound from "@/assets/sounds/ring.wav";
import { RING_VOLUME, RING_VOLUME_IN_ROOM } from "./ring";
import { soundVolume } from "@/features/settings";
import { chosenOutput } from "./sound";

/** Começa o toque e devolve quem o para. Falhar (sem saída, sem permissão) é silêncio. */
export function startRingtone(inRoom: boolean): () => void {
	const audio = new Audio(ringSound) as HTMLAudioElement & {
		setSinkId?: (id: string) => Promise<void>;
	};
	audio.loop = true;
	audio.volume = (inRoom ? RING_VOLUME_IN_ROOM : RING_VOLUME) * soundVolume();
	let stopped = false;
	const output = chosenOutput();
	const ready =
		output && audio.setSinkId
			? audio.setSinkId(output).catch(() => {})
			: Promise.resolve();
	void ready
		.then(() => (stopped ? undefined : audio.play()))
		.catch(() => {});
	return () => {
		stopped = true;
		audio.pause();
		audio.currentTime = 0;
	};
}
