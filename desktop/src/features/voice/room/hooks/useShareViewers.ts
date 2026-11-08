import {
	type Participant,
	type RemoteParticipant,
	type Room,
	RoomEvent,
} from "livekit-client";
import { useEffect, useState } from "react";
import { applyViewer, decodeViewer, VIEWERS_TOPIC } from "../model/viewers";

const NONE: ReadonlySet<string> = new Set();

/**
 * As identidades de quem está assistindo a própria transmissão (`model/viewers.ts`). Vazio sem
 * transmissão: cada uma começa do zero.
 */
export function useShareViewers(
	room: Room | null,
	active: boolean,
): ReadonlySet<string> {
	const [viewers, setViewers] = useState<ReadonlySet<string>>(NONE);

	useEffect(() => {
		if (!room || !active) return;
		const me = room.localParticipant.identity;
		const onData = (
			payload: Uint8Array,
			participant?: RemoteParticipant,
			_kind?: unknown,
			topic?: string,
		) => {
			if (topic !== VIEWERS_TOPIC || !participant) return;
			const message = decodeViewer(payload);
			if (!message) return;
			setViewers((current) =>
				applyViewer(current, participant.identity, message, me),
			);
		};
		const onLeft = (participant: Participant) => {
			setViewers((current) =>
				applyViewer(current, participant.identity, { watching: null }, me),
			);
		};
		room.on(RoomEvent.DataReceived, onData);
		room.on(RoomEvent.ParticipantDisconnected, onLeft);
		return () => {
			room.off(RoomEvent.DataReceived, onData);
			room.off(RoomEvent.ParticipantDisconnected, onLeft);
			setViewers(NONE);
		};
	}, [room, active]);

	return viewers;
}
