/**
 * Lidas e silenciar (ADR 0022): levar o ponteiro de um canal ou conversa até uma mensagem, marcar
 * tudo como lido e silenciar. Cada mudança também chega pelo tempo real, como `channel.state`, nas
 * outras conexões da pessoa.
 */
import { apiFetch, apiJson, jsonRequest } from "../client";
import type { MarkReadRequest, MuteRequest, ReadState } from "../generated";

function channelPath(channelId: string, what: "read" | "mute"): string {
	return `/api/channels/${encodeURIComponent(channelId)}/${what}`;
}

/**
 * `PUT /api/channels/{id}/read`: lido até `message_id`. O ponteiro não volta: com uma mensagem mais
 * velha que a já lida, devolve o estado de antes.
 */
export function markRead(
	channelId: string,
	request: MarkReadRequest,
): Promise<ReadState> {
	return apiJson<ReadState>(
		channelPath(channelId, "read"),
		jsonRequest("PUT", request),
	);
}

/** `POST /api/read-all`: todo canal de texto e toda conversa vão para o fim. */
export async function markAllRead(): Promise<void> {
	await apiFetch("/api/read-all", { method: "POST" });
}

/** `PUT /api/channels/{id}/mute`: silencia ou volta a ouvir. */
export function setMuted(
	channelId: string,
	request: MuteRequest,
): Promise<ReadState> {
	return apiJson<ReadState>(
		channelPath(channelId, "mute"),
		jsonRequest("PUT", request),
	);
}
