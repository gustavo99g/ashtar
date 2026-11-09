/**
 * Quais trilhas da sala este app baixa. A sala entra com `autoSubscribe: false` (no
 * `VoiceProvider`), e cada publicação passa por aqui: a voz de todo mundo, sempre; a tela
 * transmitida e o áudio dela, só de quem aparece na tela agora, no palco do Foco ou na miniatura
 * (`shown` do `roomView`). A tela de alguém vem da `:screen` dele (ADR 0017): conta o dono. A
 * própria `:screen` nunca é assinada: seria baixar a própria tela, e ouvir o próprio áudio.
 *
 * Na Grade, nas configurações ou no canal sem a miniatura, nenhuma transmissão é baixada: a Grade
 * não mostra a imagem, e o vídeo de uma tela gastaria a internet de cada um à toa.
 */

import {
	type RemoteParticipant,
	type RemoteTrackPublication,
	type Room,
	Track,
} from "livekit-client";
import { shareOwner } from "@/features/screen-share";

const SCREEN_SOURCES: ReadonlySet<Track.Source> = new Set([
	Track.Source.ScreenShare,
	Track.Source.ScreenShareAudio,
]);

/**
 * Se este app (de `me`) quer a trilha `source` de `identity`, com `shown` na tela (`null`:
 * ninguém).
 */
export function wantsTrack(
	source: Track.Source,
	identity: string,
	shown: string | null,
	me: string,
): boolean {
	if (!SCREEN_SOURCES.has(source)) return true;
	const owner = shareOwner(identity);
	return owner !== me && owner === shown;
}

/** Assina ou cancela uma publicação, só quando muda: cada troca é uma mensagem ao servidor. */
export function syncSubscription(
	publication: RemoteTrackPublication,
	participant: RemoteParticipant,
	shown: string | null,
	me: string,
): void {
	const want = wantsTrack(publication.source, participant.identity, shown, me);
	if (publication.isDesired !== want) publication.setSubscribed(want);
}

/** Passa por todas as publicações de quem está na sala. */
export function syncSubscriptions(room: Room, shown: string | null): void {
	const me = room.localParticipant.identity;
	for (const participant of room.remoteParticipants.values()) {
		for (const publication of participant.trackPublications.values()) {
			syncSubscription(publication, participant, shown, me);
		}
	}
}
