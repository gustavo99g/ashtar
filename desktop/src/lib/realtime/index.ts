/**
 * Porta de entrada do tempo real (ADR 0015). Uma conexão só para o app inteiro: o `RealtimeBridge`
 * do `app/` liga com a sessão e desliga sem ela, e passa cada evento para o `realtime.ts` das
 * features. As telas só leem o estado (`useRealtimeOpen`), para as consultas de 5 e 30 segundos
 * pararem enquanto o socket está aberto.
 *
 * Só esta pasta abre WebSocket (regra do `eslint.config.js`).
 */
import { useSyncExternalStore } from "react";
import { type ClientEvent, createRealtimeTicket, realtimeUrl } from "@/lib/api";
import {
	createRealtime,
	type RealtimeListener,
	type RealtimeStatus,
} from "./connection";

export {
	BACKOFF_SECONDS,
	backoffMs,
	CLOSE_SESSION_ENDED,
	createRealtime,
	IDLE_MS,
	PING_MS,
	type Realtime,
	type RealtimeEventInfo,
	type RealtimeListener,
	type RealtimeStatus,
} from "./connection";

const realtime = createRealtime({
	getTicket: async () => (await createRealtimeTicket()).ticket,
	url: realtimeUrl,
});

export function startRealtime(): void {
	realtime.start();
}

export function stopRealtime(): void {
	realtime.stop();
}

/** Para e liga de novo: depois de um 4001 em que a sessão continuou valendo. */
export function restartRealtime(): void {
	realtime.stop();
	realtime.start();
}

/** Manda um evento do app pelo socket; `false` com ele fechado. */
export function sendRealtime(event: ClientEvent): boolean {
	return realtime.send(event);
}

/** Assina os eventos. Devolve a função que desfaz. */
export function subscribeRealtime(listener: RealtimeListener): () => void {
	return realtime.onEvent(listener);
}

/** Fora do ar, tenta já ("Tentar agora" da faixa). */
export function retryRealtimeNow(): void {
	realtime.retryNow();
}

/** Quando é a próxima tentativa de voltar, ou `null` fora da espera. */
export function useRealtimeRetryAt(): number | null {
	return useSyncExternalStore(realtime.onStatus, realtime.nextRetryAt);
}

export function useRealtimeStatus(): RealtimeStatus {
	return useSyncExternalStore(realtime.onStatus, realtime.status);
}

/** Se os eventos estão chegando. Fora disso, as listas voltam a perguntar sozinhas. */
export function useRealtimeOpen(): boolean {
	return useRealtimeStatus() === "open";
}
