/**
 * O perfil de quem está usando o app (`/api/me`).
 */
import { apiJson, jsonRequest } from "../client";
import type { MeResponse, UpdateMeRequest } from "../generated";

/** `GET /api/me`: quem sou, o que posso e de qual canal vêm as atualizações. */
export function getMe(): Promise<MeResponse> {
	return apiJson<MeResponse>("/api/me");
}

/** `PATCH /api/me`: troca o nome visível (`null` ou vazio volta para o nick). Responde como o `getMe`. */
export function updateMe(request: UpdateMeRequest): Promise<MeResponse> {
	return apiJson<MeResponse>("/api/me", jsonRequest("PATCH", request));
}
