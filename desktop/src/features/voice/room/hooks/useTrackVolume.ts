import { type RemoteAudioTrack, type Room, TrackEvent } from "livekit-client";
import { useEffect } from "react";
import { applyTrackVolume } from "../model/boost";

/**
 * Mantém a trilha `track` no volume `heard` (0 a 200), enquanto o componente estiver montado. A voz
 * de cada pessoa (`RoomAudio`) e o som da transmissão (`useShareAudio`) passam por aqui.
 */
export function useTrackVolume(
	track: RemoteAudioTrack | undefined,
	heard: number,
	room: Room | null,
): void {
	useEffect(() => {
		if (!track) return;
		const apply = () => applyTrackVolume(track, heard, room);
		apply();
		// O `AudioTrack` pode ligar o elemento de áudio depois deste efeito, e o LiveKit não reaplica
		// um volume zero ao ligar: aplica de novo nessa hora.
		track.on(TrackEvent.ElementAttached, apply);
		return () => {
			track.off(TrackEvent.ElementAttached, apply);
		};
	}, [track, heard, room]);
}
