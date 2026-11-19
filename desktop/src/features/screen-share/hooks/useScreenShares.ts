import {
	type TrackReference,
	useRoomContext,
	useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { compareShares, shareOwner } from "../model/shareInfo";

/** Uma transmissão da sala, com o dono já resolvido (a trilha é da `:screen` dele). */
export interface ScreenShare {
	track: TrackReference;
	/** O id de quem transmite: a identidade da voz, sem o `:screen`. */
	ownerId: string;
	/** A transmissão deste app (a `:screen` é um participante remoto para o WebView). */
	isOwn: boolean;
}

/**
 * As transmissões da sala, pelas publicações (assinadas ou não), da mais antiga para a mais nova
 * (`compareShares`), a própria inclusive. Usa hooks do LiveKit: só com a sala conectada.
 */
export function useScreenShares(): ScreenShare[] {
	const me = useRoomContext().localParticipant.identity;
	return useTracks([Track.Source.ScreenShare], {
		onlySubscribed: false,
	})
		.map((track) => {
			const ownerId = shareOwner(track.participant.identity);
			return { track, ownerId, isOwn: ownerId === me };
		})
		.sort((a, b) =>
			compareShares(
				{
					identity: a.track.participant.identity,
					trackName: a.track.publication.trackName,
				},
				{
					identity: b.track.participant.identity,
					trackName: b.track.publication.trackName,
				},
			),
		);
}
