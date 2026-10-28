/**
 * Membros, para o Painel de controle. Toda rota responde `forbidden` (403) a quem não pode, antes
 * de procurar o id.
 */
import { apiFetch, apiJson, jsonRequest } from "../client";
import type {
	CreatedInviteView,
	GrantView,
	MemberView,
	SetBetaRequest,
} from "../generated";

function memberPath(id: string, rest = ""): string {
	return `/api/members/${encodeURIComponent(id)}${rest}`;
}

/** `GET /api/members`: todos, os removidos inclusive, do mais antigo para o mais novo. */
export function listMembers(): Promise<MemberView[]> {
	return apiJson<MemberView[]>("/api/members");
}

/** `GET /api/members/{id}/permissions`: as 8 linhas da gaveta, com a origem de cada uma. */
export function getMemberPermissions(id: string): Promise<GrantView[]> {
	return apiJson<GrantView[]>(memberPath(id, "/permissions"));
}

/** `PUT /api/members/{id}/beta`. No dono e em quem foi removido, responde `conflict` (409). */
export async function setMemberBeta(
	id: string,
	enabled: boolean,
): Promise<void> {
	const request: SetBetaRequest = { enabled };
	await apiFetch(memberPath(id, "/beta"), jsonRequest("PUT", request));
}

/** `POST /api/members/{id}/unlink`: tira o computador do membro e derruba a sessão dele. */
export async function unlinkMember(id: string): Promise<void> {
	await apiFetch(memberPath(id, "/unlink"), { method: "POST" });
}

/** `POST /api/members/{id}/recovery-invite`: recuperação de uso único, válida por 7 dias. */
export function createRecoveryInvite(id: string): Promise<CreatedInviteView> {
	return apiJson<CreatedInviteView>(memberPath(id, "/recovery-invite"), {
		method: "POST",
	});
}

/** `DELETE /api/members/{id}`: remove o membro. O nick fica livre. */
export async function removeMember(id: string): Promise<void> {
	await apiFetch(memberPath(id), { method: "DELETE" });
}
