/**
 * Sobre o próprio app: as novidades, a pasta de logs, o menu da bandeja e o iniciar com o Windows.
 * Espelha `commands/app.rs` e `tray.rs`.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { call } from "./core";

export interface ReleaseNotes {
	version: string;
	notes: string;
}

export interface WhatsNew {
	/** A versão em execução. */
	version: string;
	/** Da mais nova para a mais velha: a instalada e, com `lastSeen`, as que a pessoa pulou. */
	sections: ReleaseNotes[];
}

/**
 * As seções do CHANGELOG.md depois de `lastSeen` até a versão em execução, ou só a dela sem
 * `lastSeen`. `null` sem nenhuma.
 */
export function whatsNew(lastSeen: string | null = null) {
	return call<WhatsNew | null>("whats_new", { lastSeen });
}

/** Abre a pasta de logs do app no Explorador de Arquivos. Rejeita com um `AppError`. */
export function openLogDir() {
	return call<void>("open_log_dir");
}

/** Põe a janela em tela cheia (ou tira) e avisa a barra de tarefas do Windows. */
export function setStageFullscreen(on: boolean) {
	return call<void>("set_stage_fullscreen", { on });
}

/** O que a pessoa pediu pelo menu da bandeja durante uma transmissão (`tray.rs`). */
export type TrayShareAction = "panel" | "pause" | "resume" | "stop";

/** Mostra (ou tira) as opções da transmissão no menu da bandeja. */
export function trayShareState(sharing: boolean, paused: boolean) {
	return call<void>("tray_share_state", { sharing, paused });
}

/** Escuta os cliques nas opções da transmissão da bandeja. */
export function onTrayShare(
	callback: (action: TrayShareAction) => void,
): Promise<UnlistenFn> {
	return listen<TrayShareAction>("tray-share", (event) =>
		callback(event.payload),
	);
}

/** Se o app inicia com o Windows. Rejeita com um `AppError`. */
export function autostartEnabled() {
	return call<boolean>("autostart_enabled");
}

/** Liga ou desliga o iniciar com o Windows (ligado, o app sobe direto na bandeja). */
export function setAutostart(enabled: boolean) {
	return call<void>("set_autostart", { enabled });
}

/** Se a janela usa a placa de vídeo na próxima abertura (Configurações › Aplicativo). */
export function hardwareAcceleration() {
	return call<boolean>("hardware_acceleration");
}

/** Liga ou desliga a aceleração de hardware da janela. Vale ao reiniciar o app. */
export function setHardwareAcceleration(enabled: boolean) {
	return call<void>("set_hardware_acceleration", { enabled });
}

/** Fecha e abre o app de novo. */
export function restartApp() {
	return call<void>("restart_app");
}

/** Os logs dos últimos 2 dias e o `info.txt` num `.zip` ("Enviar logs"), em bytes. */
export function logsBundle() {
	return call<ArrayBuffer>("logs_bundle");
}
