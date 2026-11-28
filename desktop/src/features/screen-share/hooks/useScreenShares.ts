import {
	type TrackReference,
	useRoomContext,
	useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import {
	compareShares,
	shareKey,
	shareOwner,
	shareSource,
} from "../model/shareInfo";

/** Uma transmissão da sala, com o dono já resolvido (a trilha é da `:screen` dele). */
export interface ScreenShare {
	track: TrackReference;
	/** O id de quem transmite: a identidade da voz, sem o `:screen`. */
	ownerId: string;
	/**
	 * A chave da transmissão (`shareKey`): o id do dono na do computador; a identidade inteira na de
	 * um aparelho (ADR 0038). É ela que o palco, a miniatura e o volume guardam.
	 */
	key: string;
	/** O nome do aparelho que publica a tela, ou `null` na do computador. */
	source: string | null;
	/**
	 * A transmissão deste app (a `:screen` é um participante remoto para o WebView). A de um aparelho
	 * da própria pessoa não é: ela pode assistir, como qualquer outra.
	 */
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
			const identity = track.participant.identity;
			const key = shareKey(identity);
			return {
				track,
				ownerId: shareOwner(identity),
				key,
				source: shareSource(track.participant.metadata),
				isOwn: key === me,
			};
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
