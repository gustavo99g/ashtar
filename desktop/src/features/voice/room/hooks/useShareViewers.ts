import {
	type Participant,
	type RemoteParticipant,
	type Room,
	RoomEvent,
} from "livekit-client";
import { useEffect, useState } from "react";
import { applyViewer, decodeViewer, VIEWERS_TOPIC } from "../model/viewers";

const NONE: ReadonlyMap<string, number> = new Map();

/**
 * Quem está assistindo a própria transmissão (`model/viewers.ts`): a identidade e desde quando
 * (`Date.now()` do primeiro aviso). Vazio sem transmissão: cada uma começa do zero.
 */
export function useShareViewers(
	room: Room | null,
	active: boolean,
): ReadonlyMap<string, number> {
	const [viewers, setViewers] = useState<ReadonlyMap<string, number>>(NONE);

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
				applyViewer(current, participant.identity, message, me, Date.now()),
			);
		};
		const onLeft = (participant: Participant) => {
			setViewers((current) =>
				applyViewer(
					current,
					participant.identity,
					{ watching: null },
					me,
					Date.now(),
				),
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
