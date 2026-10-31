/**
 * As chamadas à API da conexão com a sala. Duas, e nenhuma guarda nada no cache: o token do LiveKit
 * vale para uma entrada só (guardá-lo seria entregá-lo de novo a quem não devia), e a conferência da
 * sessão existe justamente para perguntar à API outra vez.
 */
import { createVoiceToken, getMe } from "@/lib/api";

/** Pede o token para entrar na sala (`POST /api/voice/token`). Sem cache, de propósito. */
export function requestVoiceToken(channelId: string) {
	return createVoiceToken(channelId);
}

/**
 * Pergunta à API quem está usando (`GET /api/me`), só para ela responder. Se a pessoa saiu do grupo
 * (foi removida ou teve o computador desvinculado), o 401 leva à tela "saiu do grupo" pelo
 * `lib/api`. A resposta em si não interessa aqui.
 */
export function checkSession(): Promise<void> {
	return getMe().then(
		() => undefined,
		() => undefined,
	);
}
