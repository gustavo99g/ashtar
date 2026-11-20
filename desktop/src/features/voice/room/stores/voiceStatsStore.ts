import { create } from "zustand";
import type { VoiceStats } from "../model/voiceStats";

/**
 * Os números da conexão de cada um na sala (`voiceStats.ts`), pela identidade. Só vale dentro da
 * chamada: o `VoiceProvider` limpa ao sair e tira quem sai da sala.
 */
interface VoiceStatsState {
	byId: Readonly<Record<string, VoiceStats>>;
}

export const useVoiceStats = create<VoiceStatsState>()(() => ({ byId: {} }));

export function setVoiceStats(identity: string, stats: VoiceStats) {
	useVoiceStats.setState((state) => ({
		byId: { ...state.byId, [identity]: stats },
	}));
}

export function forgetVoiceStats(identity: string) {
	useVoiceStats.setState((state) => {
		if (!(identity in state.byId)) return state;
		const byId = { ...state.byId };
		delete byId[identity];
		return { byId };
	});
}

export function clearVoiceStats() {
	useVoiceStats.setState({ byId: {} });
}
