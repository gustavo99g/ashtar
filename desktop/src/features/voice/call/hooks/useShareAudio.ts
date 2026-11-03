import type { TrackReference } from "@livekit/components-react";
import { RemoteAudioTrack, Track, TrackEvent } from "livekit-client";
import { useEffect } from "react";
import { audibleVolume, useShareVolume } from "../stores/shareVolumeStore";

/**
 * O áudio da transmissão `share`, se ela tiver, já no volume gravado (`shareVolumeStore.ts`).
 * O palco do Foco e a miniatura usam o mesmo: o volume escolhido num vale no outro.
 */
export function useShareAudio(share: TrackReference): {
	remoteAudio: RemoteAudioTrack | undefined;
	heard: number;
} {
	const heard = useShareVolume(audibleVolume);
	const audioTrack = share.participant.getTrackPublication(
		Track.Source.ScreenShareAudio,
	)?.track;
	const remoteAudio =
		audioTrack instanceof RemoteAudioTrack ? audioTrack : undefined;

	useEffect(() => {
		if (!remoteAudio) return;
		const apply = () => remoteAudio.setVolume(heard / 100);
		apply();
		// O `RoomAudio` pode ligar o elemento de áudio depois deste efeito, e o LiveKit não
		// reaplica um volume zero ao ligar: aplica de novo nessa hora.
		remoteAudio.on(TrackEvent.ElementAttached, apply);
		return () => {
			remoteAudio.off(TrackEvent.ElementAttached, apply);
		};
	}, [remoteAudio, heard]);

	return { remoteAudio, heard };
}
