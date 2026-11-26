/**
 * Os sons do soundboard (v0.9, ADR 0037): ler os aprovados e os próprios, todo mundo; enviar, quem
 * tem "Enviar sons"; a fila, aprovar, recusar, renomear e excluir qualquer um, quem tem "Aprovar
 * sons". Tocar é da voz (`POST /api/voice/sounds/{id}/play`).
 */
import { apiFetch, apiJson, jsonRequest } from "../client";
import type {
	AuditEntry,
	CreateSoundRequest,
	RejectSoundRequest,
	Sound,
	UpdateSoundRequest,
} from "../generated";

const path = (id: string) => `/api/sounds/${encodeURIComponent(id)}`;

/** `GET /api/sounds`: os aprovados, por nome. */
export function listSounds(): Promise<Sound[]> {
	return apiJson<Sound[]>("/api/sounds");
}

/** `GET /api/sounds/mine`: os que a pessoa enviou, em qualquer situação. */
export function listMySounds(): Promise<Sound[]> {
	return apiJson<Sound[]>("/api/sounds/mine");
}

/** `GET /api/sounds/pending`: a fila de aprovação. */
export function listPendingSounds(): Promise<Sound[]> {
	return apiJson<Sound[]>("/api/sounds/pending");
}

/** `GET /api/sounds/history`: as 50 ações mais novas nos sons (aprovar, recusar, enviar direto,
 * renomear e excluir), com quem fez. Só para quem aprova. */
export function listSoundHistory(): Promise<AuditEntry[]> {
	return apiJson<AuditEntry[]>("/api/sounds/history");
}

/** `POST /api/sounds`: o 4º aguardando, o 51º aprovado e o nome repetido são `conflict`. */
export function createSound(request: CreateSoundRequest): Promise<Sound> {
	return apiJson<Sound>("/api/sounds", jsonRequest("POST", request));
}

/** `PATCH /api/sounds/{id}`: troca o nome e o emoji. */
export function updateSound(
	id: string,
	request: UpdateSoundRequest,
): Promise<Sound> {
	return apiJson<Sound>(path(id), jsonRequest("PATCH", request));
}

export function approveSound(id: string): Promise<Sound> {
	return apiJson<Sound>(`${path(id)}/approve`, { method: "POST" });
}

export function rejectSound(id: string, reason?: string): Promise<Sound> {
	const request: RejectSoundRequest = reason ? { reason } : {};
	return apiJson<Sound>(`${path(id)}/reject`, jsonRequest("POST", request));
}

/** `DELETE /api/sounds/{id}`: sai o som e o arquivo. */
export async function deleteSound(id: string): Promise<void> {
	await apiFetch(path(id), { method: "DELETE" });
}

/**
 * `POST /api/voice/sounds/{id}/play`: toca para os outros da sala ou da ligação. Fora delas é
 * `conflict`; com os sons bloqueados, `forbidden`; rápido demais, `too_many_sounds`.
 */
export async function playSound(id: string): Promise<void> {
	await apiFetch(`/api/voice/sounds/${encodeURIComponent(id)}/play`, {
		method: "POST",
	});
}
