/** Os emojis do grupo (v0.7): ler, todo mundo; o resto, quem tem "Gerenciar emojis". */
import { apiFetch, apiJson, jsonRequest } from "../client";
import type { CreateEmojiRequest, Emoji, RenameEmojiRequest } from "../generated";

/** `GET /api/emojis`: todos, por nome. */
export function listEmojis(): Promise<Emoji[]> {
	return apiJson<Emoji[]>("/api/emojis");
}

/** `POST /api/emojis`: o nome repetido e o 101º são `conflict`. */
export function createEmoji(request: CreateEmojiRequest): Promise<Emoji> {
	return apiJson<Emoji>("/api/emojis", jsonRequest("POST", request));
}

/** `PATCH /api/emojis/{id}`: troca o nome. */
export async function renameEmoji(id: string, name: string): Promise<void> {
	const request: RenameEmojiRequest = { name };
	await apiFetch(
		`/api/emojis/${encodeURIComponent(id)}`,
		jsonRequest("PATCH", request),
	);
}

/** `DELETE /api/emojis/{id}`: sai o emoji e as reações com ele. */
export async function deleteEmoji(id: string): Promise<void> {
	await apiFetch(`/api/emojis/${encodeURIComponent(id)}`, { method: "DELETE" });
}
