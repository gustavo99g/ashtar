import { type TrackReference, useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import { shareWinner } from "../model/shareInfo";

/**
 * As transmissões da sala, pelas publicações (assinadas ou não), e a que vale quando há mais de
 * uma (`shareWinner`). Usa hooks do LiveKit: só com a sala conectada.
 */
export function useScreenShares(): {
	shares: TrackReference[];
	winner: TrackReference | undefined;
} {
	const shares = useTracks([Track.Source.ScreenShare], {
		onlySubscribed: false,
	});
	const winner = shareWinner(
		shares.map((share) => ({
			share,
			identity: share.participant.identity,
			trackName: share.publication.trackName,
		})),
	)?.share;
	return { shares, winner };
}
