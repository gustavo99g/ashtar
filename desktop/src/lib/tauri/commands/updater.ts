/**
 * Atualização do app: a versão baixada, o canal e a verificação. Espelha `commands/updater.rs`.
 * Mudou lá, muda aqui.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { UpdateChannel } from "@/lib/api";
import { call } from "./core";

export interface UpdateReady {
	version: string;
}

export interface UpdateFailed {
	message: string;
}

/** A versão já baixada esperando o "reiniciar", ou `null`. */
export function pendingUpdate() {
	return call<string | null>("pending_update");
}

/** Instala a versão baixada e reinicia o app. Se der certo, não resolve: o app fecha. */
export function installUpdate() {
	return call<void>("install_update");
}

/** Pede uma verificação agora. O resultado chega por `onUpdateReady`/`onUpdateFailed`. */
export function checkForUpdate() {
	return call<void>("check_for_update");
}

export function onUpdateReady(
	callback: (event: UpdateReady) => void,
): Promise<UnlistenFn> {
	return listen<UpdateReady>("update-ready", (event) =>
		callback(event.payload),
	);
}

export function onUpdateFailed(
	callback: (event: UpdateFailed) => void,
): Promise<UnlistenFn> {
	return listen<UpdateFailed>("update-failed", (event) =>
		callback(event.payload),
	);
}

/**
 * Passa ao Rust o canal de atualização que a API mandou (`update_channel` do `/api/me`). Ele fica
 * só na memória e vale nas próximas verificações; se passou para o beta, o Rust verifica na hora.
 */
export function setUpdateChannel(channel: UpdateChannel) {
	return call<void>("set_update_channel", { channel });
}

/** O resultado do "Procurar atualização". `disabled`: no desenvolvimento, que não se atualiza. */
export type UpdateCheck =
	| { status: "upToDate" }
	| { status: "ready"; version: string }
	| { status: "offline" }
	| { status: "failed"; message: string }
	| { status: "disabled" };

/**
 * Verifica agora e espera o resultado, que pode levar o download inteiro. Os eventos
 * (`onUpdateReady`, `onUpdateFailed`) saem do mesmo jeito.
 */
export function checkForUpdateNow() {
	return call<UpdateCheck>("check_for_update_now");
}
