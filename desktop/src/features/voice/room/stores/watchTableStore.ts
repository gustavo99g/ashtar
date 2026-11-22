/**
 * Quem assiste qual transmissão na sala (`model/viewers.ts`), juntado pelo `useWatchSync`, que fica
 * montado no `VoiceProvider` durante a chamada. Os blocos do palco e o painel de quem transmite
 * leem daqui (`useShareViewers`, `useViewersOf`). Vazia fora de uma sala.
 */
import { create } from "zustand";
import { EMPTY_TABLE, type WatchTable } from "../model/viewers";

interface WatchTableState {
	table: WatchTable;
}

export const useWatchTable = create<WatchTableState>()(() => ({
	table: EMPTY_TABLE,
}));

export function updateWatchTable(change: (table: WatchTable) => WatchTable): void {
	useWatchTable.setState((state) => {
		const table = change(state.table);
		return table === state.table ? state : { table };
	});
}

export function clearWatchTable(): void {
	useWatchTable.setState({ table: EMPTY_TABLE });
}
