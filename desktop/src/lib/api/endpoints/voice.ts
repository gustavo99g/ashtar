/**
 * A sala de voz: quem está nela e o token para entrar.
 */
import { apiJson, jsonRequest } from "../client";
import type {
	JoinVoiceResponse,
	ParticipantView,
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
