/**
 * O chat: o histórico e o envio de mensagens, e quem está no grupo para a coluna de membros.
 */
import { apiFetch, apiJson, jsonRequest } from "../client";
import type {
	EditMessageRequest,
	Message,
	MessagePage,
	Person,
	SendMessageRequest,
} from "../generated";

function messagesPath(channelId: string): string {
	return `/api/channels/${encodeURIComponent(channelId)}/messages`;
}

/**
 * Para que lado ler. Dois cursores juntos a API recusa (422), então o tipo também não deixa.
 */
export type PageCursor =
	| {
			/** As mensagens antes desta (rolar para cima). */
			before?: string;
			after?: never;
			around?: never;
			limit?: number;
	  }
	| {
			/** As mensagens depois desta (o reencontro depois de uma queda). */
			after?: string;
			before?: never;
			around?: never;
			limit?: number;
	  }
	| {
			/** Metade antes e metade depois desta, com ela (ir até uma mensagem antiga). */
			around?: string;
			before?: never;
			after?: never;
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
	if (cursor.around) query.set("around", cursor.around);
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

function messagePath(messageId: string): string {
	return `/api/messages/${encodeURIComponent(messageId)}`;
}

/** `PATCH /api/messages/{id}`: troca o texto. Só o autor (`forbidden`). */
export function editMessage(
	messageId: string,
	request: EditMessageRequest,
): Promise<Message> {
	return apiJson<Message>(messagePath(messageId), jsonRequest("PATCH", request));
}

/** `DELETE /api/messages/{id}`: o autor, ou o dono numa mensagem de canal. */
export async function deleteMessage(messageId: string): Promise<void> {
	await apiFetch(messagePath(messageId), { method: "DELETE" });
}

/**
 * `PUT` (ou `DELETE`, com `on = false`) `/api/messages/{id}/reactions/{emoji}`: põe ou tira a
 * reação de quem chama. Devolve a mensagem com as reações de agora.
 */
export function setReaction(
	messageId: string,
	emoji: string,
	on: boolean,
): Promise<Message> {
	return apiJson<Message>(
		`${messagePath(messageId)}/reactions/${encodeURIComponent(emoji)}`,
		{ method: on ? "PUT" : "DELETE" },
	);
}

/** `GET /api/people`: quem está no grupo, com quem está online. */
export function listPeople(): Promise<Person[]> {
	return apiJson<Person[]>("/api/people");
}
