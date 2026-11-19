import {
	type Participant,
	type RemoteParticipant,
	type Room,
	RoomEvent,
} from "livekit-client";
import { useEffect } from "react";
import {
	applyViewer,
	decodeViewer,
	encodeViewer,
	removeViewer,
	VIEWERS_TOPIC,
} from "../model/viewers";
import { clearWatchTable, updateWatchTable } from "../stores/watchTableStore";

/**
 * Os avisos de quem assiste o quê (ADR 0024), nos dois sentidos: manda para a sala a lista das
 * transmissões que este app tem à vista (`watching`, os ids de quem transmite), a cada mudança e de
 * novo para quem entra; e junta os avisos dos outros na tabela (`watchTableStore`). Montado uma vez,
 * no `VoiceProvider`.
 */
export function useWatchSync(room: Room | null, watching: readonly string[]) {
	const key = watching.join("\n");

	// Os avisos dos outros, e quem sai da sala sai da tabela.
	useEffect(() => {
		if (!room) return;
		const onData = (
			payload: Uint8Array,
			participant?: RemoteParticipant,
			_kind?: unknown,
			topic?: string,
		) => {
			if (topic !== VIEWERS_TOPIC || !participant) return;
			const message = decodeViewer(payload);
			if (!message) return;
			updateWatchTable((table) =>
				applyViewer(table, participant.identity, message, Date.now()),
			);
		};
		const onLeft = (participant: Participant) => {
			updateWatchTable((table) => removeViewer(table, participant.identity));
		};
		room.on(RoomEvent.DataReceived, onData);
		room.on(RoomEvent.ParticipantDisconnected, onLeft);
		return () => {
			room.off(RoomEvent.DataReceived, onData);
			room.off(RoomEvent.ParticipantDisconnected, onLeft);
			clearWatchTable();
		};
	}, [room]);

	// A própria lista: para todos a cada mudança, e para quem chega.
	useEffect(() => {
		if (!room) return;
		const ids = key ? key.split("\n") : [];
		const send = (destinationIdentities?: string[]) =>
			room.localParticipant
				.publishData(encodeViewer({ watching: ids }), {
					reliable: true,
					topic: VIEWERS_TOPIC,
					destinationIdentities,
				})
				.catch((error: unknown) => {
					console.warn("Aviso de quem assiste não foi:", error);
				});
		void send();
		const onJoined = (participant: RemoteParticipant) => {
			if (ids.length > 0) void send([participant.identity]);
		};
		room.on(RoomEvent.ParticipantConnected, onJoined);
		return () => {
			room.off(RoomEvent.ParticipantConnected, onJoined);
		};
	}, [room, key]);
}
