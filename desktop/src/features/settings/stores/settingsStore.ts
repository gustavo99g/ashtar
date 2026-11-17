import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_THEME, isThemeId, type ThemeId } from "@/styles/themes";

/** As chaves de Configurações › Notificações (Etapa 15). Todas começam ligadas. */
export interface NotificationPrefs {
	/** Aviso de mensagem privada. */
	dms: boolean;
	/** Aviso de menção num canal. */
	mentions: boolean;
	/** Aviso de "Fulano começou a transmitir". */
	streams: boolean;
	/** O som que acompanha o aviso. */
	sounds: boolean;
}

export const DEFAULT_NOTIFICATIONS: NotificationPrefs = {
	dms: true,
	mentions: true,
	streams: true,
	sounds: true,
};

interface SettingsState {
	theme: ThemeId;
	notifications: NotificationPrefs;
	setTheme: (theme: ThemeId) => void;
	setNotification: (key: keyof NotificationPrefs, enabled: boolean) => void;
}

/** As chaves salvas, com o padrão no lugar de qualquer valor estranho. */
function readNotifications(value: unknown): NotificationPrefs {
	const saved = (typeof value === "object" && value !== null ? value : {}) as Record<
		string,
		unknown
	>;
	const pick = (key: keyof NotificationPrefs) =>
		typeof saved[key] === "boolean" ? saved[key] : DEFAULT_NOTIFICATIONS[key];
	return {
		dms: pick("dms"),
		mentions: pick("mentions"),
		streams: pick("streams"),
		sounds: pick("sounds"),
	};
}

/**
 * Preferências deste computador. Ficam no `localStorage` do app, fora da API. A janela dos avisos
 * lê o mesmo `localStorage` (o tema e o som), então o que muda aqui vale lá no próximo aviso.
 */
export const useSettingsStore = create<SettingsState>()(
	persist(
		(set) => ({
			theme: DEFAULT_THEME,
			notifications: DEFAULT_NOTIFICATIONS,
			setTheme: (theme) => set({ theme }),
			setNotification: (key, enabled) =>
				set((state) => ({
					notifications: { ...state.notifications, [key]: enabled },
				})),
		}),
		{
			name: "ashtar-settings",
			version: 1,
			partialize: (state) => ({
				theme: state.theme,
				notifications: state.notifications,
			}),
			// Um tema que saiu do app (ou um valor estranho no disco) volta para o padrão. Quem vem
			// de antes da 0.3.10 não tem as chaves de notificação: entram ligadas.
			merge: (persisted, current) => {
				const saved = persisted as
					| { theme?: unknown; notifications?: unknown }
					| undefined;
				return {
					...current,
					theme: isThemeId(saved?.theme) ? saved.theme : DEFAULT_THEME,
					notifications: readNotifications(saved?.notifications),
				};
			},
		},
	),
);
