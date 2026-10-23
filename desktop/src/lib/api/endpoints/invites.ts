/**
 * Convites: ler antes de entrar (sem sessão) e, no Painel, criar, listar e revogar.
 */
import { apiFetch, apiJson, jsonRequest } from "../client";
import type {
	CreatedInviteView,
	CreateInviteRequest,
	InvitePreviewView,
	InviteView,
} from "../generated";

/**
 * `GET /api/invites/{código}`: quem convidou, ou de quem é a conta na recuperação, sem gastar o
 * convite. Não precisa de sessão. Um código que não vale responde `invalid_invite` e conta no
 * limite de tentativas da API.
 */
export function getInvite(code: string): Promise<InvitePreviewView> {
	return apiJson<InvitePreviewView>(`/api/invites/${encodeURIComponent(code)}`);
}

/** `POST /api/invites`: cria um convite pelo modelo. O código e o link só aparecem nesta resposta. */
export function createInvite(
	request: CreateInviteRequest,
): Promise<CreatedInviteView> {
	return apiJson<CreatedInviteView>(
		"/api/invites",
		jsonRequest("POST", request),
	);
}

/** `GET /api/invites`: o histórico, do mais novo para o mais antigo. */
export function listInvites(): Promise<InviteView[]> {
	return apiJson<InviteView[]>("/api/invites");
}

/** `POST /api/invites/{id}/revoke`. Um convite que já não vale responde `conflict` (409). */
export async function revokeInvite(id: string): Promise<void> {
	await apiFetch(`/api/invites/${encodeURIComponent(id)}/revoke`, {
		method: "POST",
	});
}
