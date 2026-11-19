import {
	AudioTrack,
	type TrackReference,
	useTracks,
} from "@livekit/components-react";
import { RemoteAudioTrack, type Room, RoomEvent, Track } from "livekit-client";
import { useEffect } from "react";
import { useHeardVolume } from "../../members/stores/userVolumeStore";
import { useTrackVolume } from "../hooks/useTrackVolume";
import { followOutput } from "../model/boost";

/*
 * O som da sala: a voz de cada um e o áudio das transmissões. Faz o mesmo que o
 * `RoomAudioRenderer` do LiveKit, com duas diferenças.
 *
 * O deafen cala só as vozes. Com o áudio desativado, a pessoa não ouve ninguém falar, e a
 * transmissão que ela assiste continua com o som, no volume do Foco (`shareVolumeStore.ts`). Calar
 * uma voz também pede ao servidor que pare de mandá-la: quem entrar na sala depois do deafen também
 * não é ouvido.
 *
 * Cada voz toca no volume que quem ouve escolheu para aquela pessoa (`userVolumeStore.ts`, ADR
 * 0020). O deafen manda: com ele, todas ficam mudas, e o volume de cada uma volta ao reativar.
 */

const SOURCES = [
	Track.Source.Microphone,
	Track.Source.ScreenShareAudio,
	Track.Source.Unknown,
];

export function RoomAudio({
	room,
	deafened,
}: {
	room: Room | null;
	deafened: boolean;
}) {
	const tracks = useTracks(SOURCES, {
		updateOnlyOn: [],
		onlySubscribed: true,
	}).filter(
		(ref) =>
			!ref.participant.isLocal && ref.publication.kind === Track.Kind.Audio,
	);

	// Trocar a saída em Configurações leva junto quem está saindo pelo reforço (acima de 100%).
	useEffect(() => {
		if (!room) return;
		const onDevice = (kind: MediaDeviceKind) => {
			if (kind === "audiooutput") void followOutput(room);
		};
		room.on(RoomEvent.ActiveDeviceChanged, onDevice);
		return () => {
			room.off(RoomEvent.ActiveDeviceChanged, onDevice);
		};
	}, [room]);

	return (
		<div hidden>
			{tracks.map((ref) => {
				const key = `${ref.participant.identity}:${ref.publication.trackSid}`;
				return ref.source === Track.Source.Microphone ? (
					<Voice key={key} trackRef={ref} room={room} deafened={deafened} />
				) : (
					<AudioTrack key={key} trackRef={ref} muted={false} />
				);
			})}
		</div>
	);
}

/** A voz de uma pessoa, no volume que quem ouve escolheu para ela. */
function Voice({
	trackRef,
	room,
	deafened,
}: {
	trackRef: TrackReference;
	room: Room | null;
	deafened: boolean;
}) {
	// A identidade da voz no LiveKit é o id da pessoa na API.
	const heard = useHeardVolume(trackRef.participant.identity);
	const track = trackRef.publication.track;
	useTrackVolume(
		track instanceof RemoteAudioTrack ? track : undefined,
		heard,
		room,
	);
	return <AudioTrack trackRef={trackRef} muted={deafened} />;
}
