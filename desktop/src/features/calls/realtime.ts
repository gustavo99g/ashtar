/**
 * Os eventos do tempo real das ligações (ADR 0023): o `ready` (quem é e a ligação em andamento) e
 * os três `call.*`, que a API só manda para as duas pessoas da conversa.
 */
import type { ServerEvent } from "@/lib/api";
import { applyCall, applyEnded, applyReady } from "./stores/callStore";

export function handleCallsRealtime(event: ServerEvent): void {
	switch (event.type) {
		case "ready":
			applyReady(event.user_id, event.call ?? null);
			break;
		case "call.ringing":
		case "call.accepted":
			applyCall(event.call);
			break;
		case "call.ended":
			applyEnded(event);
			break;
	}
}
