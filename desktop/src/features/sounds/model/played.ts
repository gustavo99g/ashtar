/**
 * O `voice.sound_played` chega pelo tempo real, mas quem toca precisa da voz (a sala em que a
 * pessoa está, se está surda), que é da `features/voice`. O aviso passa por aqui: o realtime
 * publica, e o tocador da voz ouve.
 */

export interface SoundPlayed {
	soundId: string;
	fileId: string;
	userId: string;
	channelId: string;
}

type Listener = (played: SoundPlayed) => void;

const listeners = new Set<Listener>();

export function onSoundPlayed(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function emitSoundPlayed(played: SoundPlayed): void {
	for (const listener of listeners) listener(played);
}
