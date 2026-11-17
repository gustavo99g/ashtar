/**
 * Os avisos do app: a janela própria no canto da tela e o ponto de não lido. Espelha
 * `commands/notifications.rs` e `notifications.rs`.
 *
 * O cartão e o alvo vão como JSON: quem monta e quem lê é a `features/notifications`, nas duas
 * janelas. Aqui eles são opacos (`unknown`), e cada lado confere o que recebeu.
 *
 * Fora do Tauri (o `pnpm dev` no navegador), nada aparece e ninguém escuta.
 */
import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { call } from "./core";

/**
 * Leva um cartão à janela dos avisos. Resolve `false` quando o aviso não apareceu: o Windows pediu
 * silêncio (tela cheia, apresentação) ou o app não está no Tauri.
 */
export async function notificationShow(card: unknown): Promise<boolean> {
	if (!isTauri()) return false;
	return call<boolean>("notification_show", { card });
}

/** A janela dos avisos diz a altura da pilha, em pixels; zero a esconde. */
export function notificationLayout(height: number) {
	if (!isTauri()) return Promise.resolve();
	return call<void>("notification_layout", { height });
}

/** Um cartão foi clicado: traz a janela principal e entrega o alvo a ela. */
export function notificationOpen(target: unknown) {
	if (!isTauri()) return Promise.resolve();
	return call<void>("notification_open", { target });
}

/** Liga ou desliga a bolinha da bandeja e o selo da barra de tarefas. */
export function setUnreadBadge(unread: boolean) {
	if (!isTauri()) return Promise.resolve();
	return call<void>("set_unread_badge", { unread });
}

function listenIfTauri(
	event: string,
	callback: (payload: unknown) => void,
): Promise<UnlistenFn> {
	if (!isTauri()) return Promise.resolve(() => {});
	return listen<unknown>(event, (e) => callback(e.payload));
}

/** Na janela dos avisos: escuta os cartões que chegam. */
export function onNotificationCard(
	callback: (card: unknown) => void,
): Promise<UnlistenFn> {
	return listenIfTauri("notification-card", callback);
}

/** Na janela principal: escuta o alvo de um cartão clicado. */
export function onNotificationOpen(
	callback: (target: unknown) => void,
): Promise<UnlistenFn> {
	return listenIfTauri("notification-open", callback);
}
