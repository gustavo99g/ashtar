/**
 * Quais trilhas da sala este app baixa. A sala entra com `autoSubscribe: false` (no
 * `VoiceProvider`), e cada publicação passa por aqui: a voz de todo mundo, sempre; a tela
 * transmitida e o áudio dela, só de quem está no palco do Foco agora (`onStage` do `roomView`).
 *
 * Na Grade, nas configurações ou na tela do servidor, nenhuma transmissão é baixada: a Grade não
 * mostra a imagem, e o vídeo de uma tela gastaria a internet de cada um à toa.
 */
import {
	type RemoteParticipant,
	type RemoteTrackPublication,
	type Room,
	Track,
} from "livekit-client";

const SCREEN_SOURCES: ReadonlySet<Track.Source> = new Set([
	Track.Source.ScreenShare,
	Track.Source.ScreenShareAudio,
]);

/** Se este app quer a trilha `source` de `identity`, com `onStage` no palco (`null`: ninguém). */
export function wantsTrack(
	source: Track.Source,
	identity: string,
	onStage: string | null,
): boolean {
	return SCREEN_SOURCES.has(source) ? identity === onStage : true;
}

/** Assina ou cancela uma publicação, só quando muda: cada troca é uma mensagem ao servidor. */
export function syncSubscription(
	publication: RemoteTrackPublication,
	participant: RemoteParticipant,
	onStage: string | null,
): void {
	const want = wantsTrack(publication.source, participant.identity, onStage);
	if (publication.isDesired !== want) publication.setSubscribed(want);
}

/** Passa por todas as publicações de quem está na sala. */
export function syncSubscriptions(room: Room, onStage: string | null): void {
	for (const participant of room.remoteParticipants.values()) {
		for (const publication of participant.trackPublications.values()) {
			syncSubscription(publication, participant, onStage);
		}
	}
}
