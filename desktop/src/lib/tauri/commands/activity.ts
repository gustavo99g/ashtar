/**
 * O jogo aberto agora e Configurações › Atividade (ADR 0033). Espelha `commands/activity.rs` e
 * `activity/mod.rs`. Mudou lá, muda aqui.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { DetectableGame } from "@/lib/api";
import { call } from "./core";

export type GameSource =
	| "manual"
	| "steam"
	| "epic"
	| "gog"
	| "installed"
	| "discord";

/** O jogo do cartão. */
export interface GameView {
	id: string;
	name: string;
	exe: string;
	source: GameSource;
	/** O processo: a janela dele é a que o Transmitir pega na lista do seletor. */
	pid: number;
	/** Quando o processo abriu (milissegundos desde 1970). */
	startedMs: number;
	/** `data:image/png;base64,...`, ou `null` (o cartão desenha o controle). */
	icon: string | null;
	/**
	 * Os processos abertos do mesmo jogo, do mais novo ao mais antigo (este incluído): a
	 * transmissão segue o mais novo que tem janela (o cliente e a partida do League of Legends).
	 */
	family: number[];
}

export interface SeenGame {
	id: string;
	name: string;
	exe: string;
	source: GameSource;
	lastSeen: number;
	hidden: boolean;
	icon: string | null;
}

export interface ManualGame {
	exe: string;
	name: string;
}

export interface ActivitySettingsView {
	enabled: boolean;
	seen: SeenGame[];
	manual: ManualGame[];
}

/** Uma janela do seletor, no "Adicionar jogo". */
export interface WindowGame {
	id: number;
	exe: string | null;
	/** O nome do jogo, se a janela já é reconhecida. */
	recognized: string | null;
}

export function activityState() {
	return call<GameView | null>("activity_state");
}

/** Cada mudança do jogo do cartão (`null`: nenhum). */
export function onActivityChanged(
	callback: (game: GameView | null) => void,
): Promise<UnlistenFn> {
	return listen<GameView | null>("activity:changed", (event) =>
		callback(event.payload),
	);
}

export function activitySettings() {
	return call<ActivitySettingsView>("activity_settings");
}

export function setActivityEnabled(enabled: boolean) {
	return call<void>("set_activity_enabled", { enabled });
}

export function setGameHidden(id: string, hidden: boolean) {
	return call<void>("set_game_hidden", { id, hidden });
}

export function addGame(windowId: number, name: string) {
	return call<ManualGame>("add_game", { windowId, name });
}

export function removeGame(exe: string) {
	return call<void>("remove_game", { exe });
}

export function activityWindows(ids: number[]) {
	return call<WindowGame[]>("activity_windows", { ids });
}

export function activityDetectableEtag() {
	return call<string | null>("activity_detectable_etag");
}

export function activitySetDetectable(etag: string, games: DetectableGame[]) {
	return call<void>("activity_set_detectable", { etag, games });
}
