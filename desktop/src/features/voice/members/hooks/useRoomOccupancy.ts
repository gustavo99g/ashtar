/**
 * Em que sala de voz cada pessoa está (ADR 0026), juntando a lista de quem está em cada sala da
 * lista de canais. A lista de cada sala é a mesma consulta da linha dela na coluna
 * (`useVoiceParticipants`), então não pergunta nada a mais: o `voice.participants` atualiza as
 * duas.
 */
import { useQueries } from "@tanstack/react-query";
import { allChannels, useChannelLayout } from "@/features/channels";
import { useSession } from "@/features/identity";
import { listVoiceParticipants } from "@/lib/api";
import { voiceKeys } from "../queries";

export interface RoomPlace {
	roomId: string;
	roomName: string;
	sharing: boolean;
}

/** Para cada pessoa numa sala de voz do grupo: qual sala, e se transmite nela. */
export function useRoomOccupancy(): Map<string, RoomPlace> {
	const { data: layout } = useChannelLayout();
	const connected = useSession().status === "connected";
	const rooms = layout
		? allChannels(layout).filter((channel) => channel.kind === "voice")
		: [];
	const lists = useQueries({
		queries: rooms.map((room) => ({
			queryKey: voiceKeys.participants(room.id),
			queryFn: () => listVoiceParticipants(room.id),
			enabled: connected,
			staleTime: 0,
		})),
	});
	const places = new Map<string, RoomPlace>();
	rooms.forEach((room, index) => {
		for (const person of lists[index]?.data ?? []) {
			places.set(person.user_id, {
				roomId: room.id,
				roomName: room.name,
				sharing: person.screen_sharing,
			});
		}
	});
	return places;
}
