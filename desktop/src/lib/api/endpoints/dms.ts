/**
 * As conversas privadas (ADR 0021): listar as suas e abrir uma com alguém. Ler e enviar são as
 * rotas de mensagem de sempre (`chat.ts`), com o `id` da conversa no lugar do canal.
 */
import { apiJson, jsonRequest } from "../client";
import type { Conversation, OpenDmRequest } from "../generated";

/**
 * `GET /api/dms`: as conversas de quem pede que têm pelo menos uma mensagem, da que andou por
 * último para a mais parada.
 */
export function listDms(): Promise<Conversation[]> {
	return apiJson<Conversation[]>("/api/dms");
}

/**
 * `POST /api/dms`: abre a conversa com `user_id`, ou devolve a que já existe. Rejeita com
 * `not_found` se a pessoa não está mais no grupo.
 */
export function openDm(request: OpenDmRequest): Promise<Conversation> {
	return apiJson<Conversation>("/api/dms", jsonRequest("POST", request));
}
