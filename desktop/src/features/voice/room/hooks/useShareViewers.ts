import type { Room } from "livekit-client";
import { useMemo } from "react";
import { viewersOf } from "../model/viewers";
import { useWatchTable } from "../stores/watchTableStore";

const NONE: ReadonlyMap<string, number> = new Map();

/**
 * Quem está assistindo a própria transmissão (`model/viewers.ts`): a identidade e desde quando
 * (`Date.now()` do primeiro aviso). Vazio sem transmissão.
 */
export function useShareViewers(
	room: Room | null,
	active: boolean,
): ReadonlyMap<string, number> {
	const me = room?.localParticipant.identity ?? null;
	return useViewersOf(active ? me : null);
}

/** Quem está assistindo a transmissão de `owner`, e desde quando. Vazio com `owner` nulo. */
export function useViewersOf(
	owner: string | null,
): ReadonlyMap<string, number> {
	const table = useWatchTable((state) => state.table);
	return useMemo(
		() => (owner ? viewersOf(table, owner) : NONE),
		[table, owner],
	);
}
