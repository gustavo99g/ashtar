import { AudioTrack, useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";

/*
 * O som da sala: a voz de cada um e o áudio das transmissões. Faz o mesmo que o
 * `RoomAudioRenderer` do LiveKit, com uma diferença: o deafen cala só as vozes. Com o áudio
 * desativado, a pessoa não ouve ninguém falar, e a transmissão que ela assiste continua com o som,
 * no volume do Foco (`shareVolume.ts`).
 *
 * Calar uma voz também pede ao servidor que pare de mandá-la: quem entrar na sala depois do deafen
 * também não é ouvido.
 */

const SOURCES = [
	Track.Source.Microphone,
	Track.Source.ScreenShareAudio,
	Track.Source.Unknown,
];

export function RoomAudio({ deafened }: { deafened: boolean }) {
	const tracks = useTracks(SOURCES, {
		updateOnlyOn: [],
		onlySubscribed: true,
	}).filter(
		(ref) =>
			!ref.participant.isLocal && ref.publication.kind === Track.Kind.Audio,
	);

	return (
		<div hidden>
			{tracks.map((ref) => (
				<AudioTrack
					key={`${ref.participant.identity}:${ref.publication.trackSid}`}
					trackRef={ref}
					muted={deafened && ref.source === Track.Source.Microphone}
				/>
			))}
		</div>
	);
}
