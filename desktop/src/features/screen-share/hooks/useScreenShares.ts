import {
	type TrackReference,
	useRoomContext,
	useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { shareOwner, shareWinner } from "../model/shareInfo";

/** Uma transmissão da sala, com o dono já resolvido (a trilha é da `:screen` dele). */
export interface ScreenShare {
	track: TrackReference;
	/** O id de quem transmite: a identidade da voz, sem o `:screen`. */
	ownerId: string;
	/** A transmissão deste app (a `:screen` é um participante remoto para o WebView). */
	isOwn: boolean;
}

/**
 * As transmissões da sala, pelas publicações (assinadas ou não), e a que vale quando há mais de
 * uma (`shareWinner`). Usa hooks do LiveKit: só com a sala conectada.
 */
export function useScreenShares(): {
	shares: ScreenShare[];
	winner: ScreenShare | undefined;
} {
	const me = useRoomContext().localParticipant.identity;
	const shares = useTracks([Track.Source.ScreenShare], {
		onlySubscribed: false,
	}).map((track) => {
		const ownerId = shareOwner(track.participant.identity);
		return { track, ownerId, isOwn: ownerId === me };
	});
	const winner = shareWinner(
		shares.map((share) => ({
			share,
			identity: share.track.participant.identity,
			trackName: share.track.publication.trackName,
		})),
	)?.share;
	return { shares, winner };
}
