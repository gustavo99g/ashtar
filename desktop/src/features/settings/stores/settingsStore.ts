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

/** Os sons da sala (v0.5, ADR 0027): um por acontecimento, todos ligados por padrão. */
export const ROOM_SOUND_IDS = [
	"join",
	"leave",
	"mute",
	"unmute",
	"deafen",
	"undeafen",
	"shareStart",
	"shareStop",
	"ptt",
	"screenshot",
	"cameraOn",
	"cameraOff",
] as const;

export type RoomSoundId = (typeof ROOM_SOUND_IDS)[number];

export type RoomSoundPrefs = Record<RoomSoundId, boolean>;

export const DEFAULT_ROOM_SOUNDS: RoomSoundPrefs = {
	join: true,
	leave: true,
	mute: true,
	unmute: true,
	deafen: true,
	undeafen: true,
	shareStart: true,
	shareStop: true,
	// O clique do pressionar para falar (v0.6, ADR 0029): só quem aperta ouve, e começa desligado.
	ptt: false,
	// O clique de câmera do print da transmissão (v0.8).
	screenshot: true,
	// A própria câmera ligando e desligando (v0.8).
	cameraOn: true,
	cameraOff: true,
};

/** O volume dos sons do Ashtar (v0.6): de 0 a 100%, para todos os sons do app. */
export const DEFAULT_SOUND_VOLUME = 100;

function readSoundVolume(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.min(100, Math.max(0, value))
		: DEFAULT_SOUND_VOLUME;
}

/**
 * O volume dos sons, de 0 a 1, lido do `localStorage`: a janela dos avisos tem o seu próprio store,
 * e a régua muda na janela principal. Lendo do disco, o próximo som já sai no volume novo.
 */
export function soundVolume(): number {
	try {
		const saved = JSON.parse(localStorage.getItem("ashtar-settings") ?? "null");
		return readSoundVolume(saved?.state?.soundVolume) / 100;
	} catch {
		return DEFAULT_SOUND_VOLUME / 100;
	}
}

function readRoomSounds(value: unknown): RoomSoundPrefs {
	const saved = (typeof value === "object" && value !== null ? value : {}) as Record<
		string,
		unknown
	>;
	const prefs = { ...DEFAULT_ROOM_SOUNDS };
	for (const id of ROOM_SOUND_IDS) {
		if (typeof saved[id] === "boolean") prefs[id] = saved[id];
	}
	return prefs;
}

interface SettingsState {
	theme: ThemeId;
	notifications: NotificationPrefs;
	/**
	 * Perguntar antes de ligar estando numa sala (o "Ligar para fulano?", Etapa 20 da v0.3). O
	 * "Não perguntar de novo" desliga; Configurações › Voz e vídeo liga de volta.
	 */
	askBeforeCall: boolean;
	/**
	 * Perguntar antes de trocar de sala transmitindo ou com a câmera ligada (v0.5, ADR 0026): as duas
	 * acabam na troca. O "Não perguntar de novo" desliga; Configurações › Voz e vídeo liga de volta.
	 */
	askBeforeSwitchRoom: boolean;
	roomSounds: RoomSoundPrefs;
	/** O volume dos sons do Ashtar, de 0 a 100 (%). */
	soundVolume: number;
	/** "Salvar prints no computador" (v0.8): além da área de transferência, um PNG em Imagens\Ashtar. */
	saveScreenshots: boolean;
	setSaveScreenshots: (save: boolean) => void;
	setSoundVolume: (volume: number) => void;
	setTheme: (theme: ThemeId) => void;
	setRoomSound: (id: RoomSoundId, enabled: boolean) => void;
	setNotification: (key: keyof NotificationPrefs, enabled: boolean) => void;
	setAskBeforeCall: (ask: boolean) => void;
	setAskBeforeSwitchRoom: (ask: boolean) => void;
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
			askBeforeCall: true,
			askBeforeSwitchRoom: true,
			roomSounds: DEFAULT_ROOM_SOUNDS,
			soundVolume: DEFAULT_SOUND_VOLUME,
			saveScreenshots: false,
			setSaveScreenshots: (saveScreenshots) => set({ saveScreenshots }),
			setSoundVolume: (volume) => set({ soundVolume: readSoundVolume(volume) }),
			setTheme: (theme) => set({ theme }),
			setRoomSound: (id, enabled) =>
				set((state) => ({
					roomSounds: { ...state.roomSounds, [id]: enabled },
				})),
			setAskBeforeCall: (askBeforeCall) => set({ askBeforeCall }),
			setAskBeforeSwitchRoom: (askBeforeSwitchRoom) =>
				set({ askBeforeSwitchRoom }),
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
				askBeforeCall: state.askBeforeCall,
				askBeforeSwitchRoom: state.askBeforeSwitchRoom,
				roomSounds: state.roomSounds,
				soundVolume: state.soundVolume,
				saveScreenshots: state.saveScreenshots,
			}),
			// Um tema que saiu do app (ou um valor estranho no disco) volta para o padrão. Quem vem
			// de antes da 0.3.10 não tem as chaves de notificação: entram ligadas. O "perguntar antes de
			// ligar" é da 0.3.20 e também começa ligado.
			merge: (persisted, current) => {
				const saved = persisted as
					| {
							theme?: unknown;
							notifications?: unknown;
							askBeforeCall?: unknown;
							askBeforeSwitchRoom?: unknown;
							roomSounds?: unknown;
							soundVolume?: unknown;
							saveScreenshots?: unknown;
					  }
					| undefined;
				return {
					...current,
					theme: isThemeId(saved?.theme) ? saved.theme : DEFAULT_THEME,
					notifications: readNotifications(saved?.notifications),
					askBeforeCall:
						typeof saved?.askBeforeCall === "boolean"
							? saved.askBeforeCall
							: true,
					askBeforeSwitchRoom:
						typeof saved?.askBeforeSwitchRoom === "boolean"
							? saved.askBeforeSwitchRoom
							: true,
					roomSounds: readRoomSounds(saved?.roomSounds),
					soundVolume: readSoundVolume(saved?.soundVolume),
					saveScreenshots: saved?.saveScreenshots === true,
				};
			},
		},
	),
);
