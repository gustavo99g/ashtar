import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_THEME, isThemeId, type ThemeId } from "@/styles/themes";

interface SettingsState {
	theme: ThemeId;
	setTheme: (theme: ThemeId) => void;
}

/** Preferências deste computador. Ficam no `localStorage` do app, fora da API. */
export const useSettingsStore = create<SettingsState>()(
	persist(
		(set) => ({
			theme: DEFAULT_THEME,
			setTheme: (theme) => set({ theme }),
		}),
		{
			name: "ashtar-settings",
			version: 1,
			partialize: (state) => ({ theme: state.theme }),
			// Um tema que saiu do app (ou um valor estranho no disco) volta para o padrão.
			merge: (persisted, current) => {
				const theme = (persisted as { theme?: unknown } | undefined)?.theme;
				return { ...current, theme: isThemeId(theme) ? theme : DEFAULT_THEME };
			},
		},
	),
);
