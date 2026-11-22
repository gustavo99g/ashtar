/**
 * A sala de voz: quem está nela e o token para entrar.
 */
import { apiFetch, apiJson, jsonRequest } from "../client";
import type {
	DisconnectMemberRequest,
	JoinVoiceResponse,
	MoveMemberRequest,
	ParticipantView,
	VoiceFlags,
	VoiceStateRequest,
	VoiceTokenRequest,
} from "../generated";

/** `GET /api/voice/participants`: quem está na sala, na ordem em que entrou. Sala vazia é `[]`. */
export function listVoiceParticipants(
	channelId: string,
): Promise<ParticipantView[]> {
	const query = new URLSearchParams({ channel_id: channelId });
	return apiJson<ParticipantView[]>(`/api/voice/participants?${query}`);
}

/** `POST /api/voice/token`: o token do LiveKit e o endereço da sala, com o nome do banco. */
export function createVoiceToken(
	channelId: string,
): Promise<JoinVoiceResponse> {
	const request: VoiceTokenRequest = { channel_id: channelId };
	return apiJson<JoinVoiceResponse>(
		"/api/voice/token",
		jsonRequest("POST", request),
	);
}

/**
 * `POST /api/voice/screen-token`: o token da conexão que transmite a tela (`{id}:screen`). Só para
 * quem já está na sala pela voz (409 para os outros). Vale 5 minutos para entrar.
 */
export function createScreenToken(
	channelId: string,
): Promise<JoinVoiceResponse> {
	const request: VoiceTokenRequest = { channel_id: channelId };
	return apiJson<JoinVoiceResponse>(
		"/api/voice/screen-token",
		jsonRequest("POST", request),
	);
}

/**
 * `POST /api/voice/move`: põe alguém em outra sala de voz (ADR 0026), com "Mover membros". O app
 * da pessoa troca de sala sozinho, pelo `voice.moved`.
 */
/** O token de 1 minuto da sala só sua do Testar conexão (`teste:{id}`). */
export function createTestToken(): Promise<JoinVoiceResponse> {
	return apiJson<JoinVoiceResponse>(
		"/api/voice/test-token",
		jsonRequest("POST", {}),
	);
}

export async function moveMember(
	userId: string,
	channelId: string,
): Promise<void> {
	const request: MoveMemberRequest = { user_id: userId, channel_id: channelId };
	await apiFetch("/api/voice/move", jsonRequest("POST", request));
}

/**
 * `PUT /api/voice/state`: o próprio estado na sala do grupo (microfone, áudio, câmera e tela), para
 * quem está fora dela ver. As ligações privadas não mandam.
 */
export async function putVoiceState(
	channelId: string,
	flags: VoiceFlags,
): Promise<void> {
	const request: VoiceStateRequest = { channel_id: channelId, ...flags };
	await apiFetch("/api/voice/state", jsonRequest("PUT", request));
}

/** `DELETE /api/voice/state`: saiu da sala; a API esquece o estado e relê a sala. */
export async function leaveVoiceState(channelId: string): Promise<void> {
	const query = new URLSearchParams({ channel_id: channelId });
	await apiFetch(`/api/voice/state?${query}`, { method: "DELETE" });
}

/** `POST /api/voice/disconnect`: tira alguém da voz (ADR 0026), com "Mover membros". */
export async function disconnectMember(userId: string): Promise<void> {
	const request: DisconnectMemberRequest = { user_id: userId };
	await apiFetch("/api/voice/disconnect", jsonRequest("POST", request));
}
