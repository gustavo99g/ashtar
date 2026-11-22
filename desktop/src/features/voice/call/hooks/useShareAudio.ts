import type { TrackReference } from "@livekit/components-react";
import { RemoteAudioTrack, Track } from "livekit-client";
import { shareOwner } from "@/features/screen-share";
import { useTrackVolume } from "../../room/hooks/useTrackVolume";
import { useVoice } from "../../room/hooks/useVoice";
import { audibleVolume, useShareVolume } from "../stores/shareVolumeStore";

/**
 * O áudio da transmissão `share`, se ela tiver, já no volume gravado para quem transmite
 * (`shareVolumeStore.ts`). O palco e a miniatura usam o mesmo: o volume escolhido num vale no outro.
 * Cada transmissão aberta toca o seu, ao mesmo tempo.
 *
 * Como o volume chega à trilha, e o reforço acima de 100%, estão em `room/model/boost.ts`, que a
 * voz de cada pessoa também usa.
 */
export function useShareAudio(share: TrackReference): {
	remoteAudio: RemoteAudioTrack | undefined;
	heard: number;
} {
	const { room } = useVoice();
	const owner = shareOwner(share.participant.identity);
	const heard = useShareVolume((state) => audibleVolume(state, owner));
	const audioTrack = share.participant.getTrackPublication(
		Track.Source.ScreenShareAudio,
	)?.track;
	const remoteAudio =
		audioTrack instanceof RemoteAudioTrack ? audioTrack : undefined;

	useTrackVolume(remoteAudio, heard, room);

	return { remoteAudio, heard };
}
