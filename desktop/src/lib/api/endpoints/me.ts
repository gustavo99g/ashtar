/**
 * O perfil de quem está usando o app (`/api/me`).
 */
import { apiJson, jsonRequest } from "../client";
import type { MeResponse, Status, UpdateMeRequest } from "../generated";

/** `GET /api/me`: quem sou, o que posso e de qual canal vêm as atualizações. */
export function getMe(): Promise<MeResponse> {
	return apiJson<MeResponse>("/api/me");
}

/** `PATCH /api/me`: troca o nome visível (`null` ou vazio volta para o nick). Responde como o `getMe`. */
export function updateMe(request: UpdateMeRequest): Promise<MeResponse> {
	return apiJson<MeResponse>("/api/me", jsonRequest("PATCH", request));
}

/**
 * `PUT /api/me/status`: Disponível, Ocupado ou Invisível. Responde como o `getMe`. Os outros
 * recebem o que podem ver (`presence.changed`); as suas outras conexões, o `status.changed`.
 */
export function setStatus(status: Status): Promise<MeResponse> {
	return apiJson<MeResponse>("/api/me/status", jsonRequest("PUT", { status }));
}

/** `PUT /api/me/avatar`: troca a foto por um arquivo `avatar` já enviado. Responde como o `getMe`. */
export function setAvatar(fileId: string): Promise<MeResponse> {
	return apiJson<MeResponse>(
		"/api/me/avatar",
		jsonRequest("PUT", { file_id: fileId }),
	);
}

/** `DELETE /api/me/avatar`: tira a foto (volta a letra e a cor). Responde como o `getMe`. */
export function removeAvatar(): Promise<MeResponse> {
	return apiJson<MeResponse>("/api/me/avatar", { method: "DELETE" });
}
