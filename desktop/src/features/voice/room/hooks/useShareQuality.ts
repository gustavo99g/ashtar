import { type RemoteParticipant, type Room, RoomEvent } from "livekit-client";
import { useEffect, useState } from "react";
import {
	decodeShareQuality,
	encodeShareQuality,
	QUALITY_TOPIC,
} from "@/features/screen-share";
import type { Quality } from "@/lib/tauri/commands";

/**
 * Quem transmite: avisa a qualidade pela voz (`shareInfo.ts`) quando ela muda e quando alguém
 * começa a assistir, para quem chegou depois de uma troca. `quality` `null`: sem transmissão.
 */
export function useAnnounceShareQuality(
	room: Room | null,
	quality: Quality | null,
	viewers: ReadonlyMap<string, number>,
): void {
	// Só a lista de quem assiste importa, não a hora de cada um.
	const watchers = [...viewers.keys()].sort().join(",");
	useEffect(() => {
		if (!room || !quality) return;
		room.localParticipant
			.publishData(encodeShareQuality(quality), {
				reliable: true,
				topic: QUALITY_TOPIC,
			})
			.catch((error: unknown) => {
				console.warn("Aviso da qualidade não foi:", error);
			});
	}, [room, quality, watchers]);
}

/**
 * Quem assiste: a qualidade que `ownerId` avisou para a transmissão `trackName`, ou `null` sem
 * aviso (vale a do nome da trilha). Uma transmissão nova (outro nome) começa sem aviso.
 */
export function useShareQuality(
	room: Room | null,
	ownerId: string | undefined,
	trackName: string | undefined,
): Quality | null {
	const [heard, setHeard] = useState<{
		trackName: string | undefined;
		quality: Quality;
	} | null>(null);

	useEffect(() => {
		if (!room || !ownerId) return;
		const onData = (
			payload: Uint8Array,
			participant?: RemoteParticipant,
			_kind?: unknown,
			topic?: string,
		) => {
			// Só vale o aviso do próprio dono, pela voz dele.
			if (topic !== QUALITY_TOPIC || participant?.identity !== ownerId) return;
			const quality = decodeShareQuality(payload);
			if (quality) setHeard({ trackName, quality });
		};
		room.on(RoomEvent.DataReceived, onData);
		return () => {
			room.off(RoomEvent.DataReceived, onData);
		};
	}, [room, ownerId, trackName]);

	return heard && heard.trackName === trackName ? heard.quality : null;
}
