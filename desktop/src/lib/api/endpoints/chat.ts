/**
 * O chat: o histórico e o envio de mensagens, e quem está no grupo para a coluna de membros.
 */
import { apiJson, jsonRequest } from "../client";
import type {
	Message,
	MessagePage,
	Person,
	SendMessageRequest,
} from "../generated";

function messagesPath(channelId: string): string {
	return `/api/channels/${encodeURIComponent(channelId)}/messages`;
}

/**
 * Para que lado ler. `before` e `after` juntos a API recusa (422), então o tipo também não deixa.
 */
export type PageCursor =
	| {
			/** As mensagens antes desta (rolar para cima). */
			before?: string;
			after?: never;
			limit?: number;
	  }
	| {
			/** As mensagens depois desta (o reencontro depois de uma queda). */
			after?: string;
			before?: never;
			limit?: number;
	  };

/**
 * `GET /api/channels/{id}/messages`. Sem cursor, as 50 mais recentes. A página vem da mais antiga
 * para a mais nova. Canal arquivado ou que não existe: `not_found`.
 */
export function listMessages(
	channelId: string,
	cursor: PageCursor = {},
): Promise<MessagePage> {
	const query = new URLSearchParams();
	if (cursor.before) query.set("before", cursor.before);
	if (cursor.after) query.set("after", cursor.after);
	if (cursor.limit) query.set("limit", String(cursor.limit));
	const search = query.toString();
	const suffix = search ? `?${search}` : "";
	return apiJson<MessagePage>(`${messagesPath(channelId)}${suffix}`);
}

/**
 * `POST /api/channels/{id}/messages`. Repetir com o mesmo `client_id` devolve a mesma mensagem.
 * Rejeita com `invalid_request` (texto), `too_many_messages` (429) ou `not_found`.
 */
export function sendMessage(
	channelId: string,
	request: SendMessageRequest,
): Promise<Message> {
	return apiJson<Message>(
		messagesPath(channelId),
		jsonRequest("POST", request),
	);
}

/** `GET /api/people`: quem está no grupo, com quem está online. */
export function listPeople(): Promise<Person[]> {
	return apiJson<Person[]>("/api/people");
}
