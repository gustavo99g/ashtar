/**
 * Os emojis que quem usa este computador escolheu por último, para a seção Recentes do seletor
 * (ADR 0032). Guardado no disco; até 16, o mais recente primeiro.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const RECENT_MAX = 16;

interface RecentEmoji {
	recent: string[];
}

export const useRecentEmoji = create<RecentEmoji>()(
	persist(() => ({ recent: [] as string[] }), {
		name: "ashtar-recent-emoji",
		version: 1,
		merge: (persisted, current) => {
			const saved = (persisted as Partial<RecentEmoji> | undefined)?.recent;
			return {
				...current,
				recent: Array.isArray(saved)
					? saved.filter((e) => typeof e === "string").slice(0, RECENT_MAX)
					: [],
			};
		},
	}),
);

export function rememberEmoji(emoji: string): void {
	useRecentEmoji.setState((state) => ({
		recent: [emoji, ...state.recent.filter((e) => e !== emoji)].slice(
			0,
			RECENT_MAX,
		),
	}));
}
