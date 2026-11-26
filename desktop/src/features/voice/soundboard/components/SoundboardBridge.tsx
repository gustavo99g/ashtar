import { useEffect, useRef } from "react";
import {
	markPlaying,
	onSoundPlayed,
	playSoundFile,
	preloadSoundFiles,
	useSoundboard,
	useSounds,
	useSoundsStore,
} from "@/features/sounds";
import { useVoice } from "../../room/hooks/useVoice";

/** Sem o som na lista (ainda não chegou o `sounds.changed`), a onda dura isso. */
const UNKNOWN_DURATION_MS = 1500;

/**
 * O tocador do soundboard (v0.9, ADR 0037), uma vez para o app inteiro: cada `voice.sound_played`
 * da sala ou da ligação em que a pessoa está toca o arquivo, no volume do soundboard, e acende a
 * onda dourada em quem tocou. Com a chave geral desligada ou o áudio desligado (deafen), só a onda.
 * Na sala, os arquivos dos aprovados já vêm baixados, para o primeiro toque não esperar.
 */
export function SoundboardBridge() {
	const voice = useVoice();
	const latest = useRef(voice);
	latest.current = voice;
	const sounds = useSounds();
	const inVoice = voice.voiceChannelId !== null;

	useEffect(
		() =>
			onSoundPlayed((played) => {
				const { voiceChannelId, isDeafened } = latest.current;
				if (voiceChannelId !== played.channelId) return;
				const sound = useSoundsStore
					.getState()
					.sounds.find((item) => item.id === played.soundId);
				markPlaying(played.userId, sound?.duration_ms ?? UNKNOWN_DURATION_MS);
				const prefs = useSoundboard.getState();
				if (!prefs.enabled || isDeafened) return;
				void playSoundFile(played.fileId, prefs.volume / 100);
			}),
		[],
	);

	useEffect(() => {
		if (inVoice) preloadSoundFiles(sounds.map((sound) => sound.file_id));
	}, [inVoice, sounds]);

	return null;
}
