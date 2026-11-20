/**
 * Os sons dos avisos. Tocam na janela dos avisos, que está à vista quando o cartão aparece: o
 * WebView2 pode suspender o áudio de uma janela escondida há muito tempo, e a principal costuma
 * estar na bandeja justamente quando o aviso importa.
 *
 * No máximo um som a cada [`SOUND_GAP_MS`]: uma rajada de mensagens não vira uma metralhadora.
 * Saem pela saída escolhida em Voz e vídeo, quando há uma.
 */
import dmSound from "@/assets/sounds/dm.wav";
import mentionSound from "@/assets/sounds/mention.wav";
import { soundVolume } from "@/features/settings";
import type { SoundId } from "./decide";

export const SOUND_GAP_MS = 3000;

const SOUNDS: Record<SoundId, string> = { dm: dmSound, mention: mentionSound };

/** Se já passou tempo bastante desde o último som. */
export function canPlay(last: number | null, now: number): boolean {
	return last === null || now - last >= SOUND_GAP_MS;
}

/**
 * A saída escolhida em Voz e vídeo, lida do `localStorage` (a chave é do `deviceChoiceStore` da
 * `features/voice`). A janela dos avisos não carrega a voz inteira só para isso.
 */
export function chosenOutput(): string | null {
	try {
		const saved = JSON.parse(localStorage.getItem("ashtar-devices") ?? "null");
		const id = saved?.state?.output?.id;
		return typeof id === "string" && id !== "" ? id : null;
	} catch {
		return null;
	}
}

let lastPlayed: number | null = null;

/** Toca o som, se o último já ficou para trás. Falhar (sem saída, sem permissão) é silêncio. */
export function playSound(id: SoundId, now = Date.now()): void {
	if (!canPlay(lastPlayed, now)) return;
	lastPlayed = now;
	const audio = new Audio(SOUNDS[id]) as HTMLAudioElement & {
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

/** Para os testes: esquece o último som. */
export function resetSoundGap(): void {
	lastPlayed = null;
}
