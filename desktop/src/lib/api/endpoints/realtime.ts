/**
 * O ticket do WebSocket. A conexão em si fica no `lib/realtime`.
 */
import { apiJson } from "../client";
import type { RealtimeTicket } from "../generated";

/** `POST /api/realtime/ticket`: vale uma vez, por 30 segundos. */
export function createRealtimeTicket(): Promise<RealtimeTicket> {
	return apiJson<RealtimeTicket>("/api/realtime/ticket", { method: "POST" });
}
