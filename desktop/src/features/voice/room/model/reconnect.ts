/**
 * A voz volta sozinha (ADR 0030, decisão 9): quando o `livekit-client` desiste de uma sala que a
 * pessoa não pediu para sair, o app pede um token novo e entra de novo, esperando 1, 2, 5, 10, 20 e
 * 30 segundos entre as tentativas, e depois a cada 30, até 5 minutos.
 */
import { DisconnectReason } from "livekit-client";

const DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000];
export const GIVE_UP_MS = 5 * 60_000;

/** A espera antes da tentativa `tries` (contando de 0). */
export function reconnectDelay(tries: number): number {
	return DELAYS_MS[Math.min(tries, DELAYS_MS.length - 1)];
}

/**
 * Se a queda pede outra tentativa. Não pedem: sair (o próprio app), a sala apagada ou fechada, a
 * pessoa tirada pela API (ela confere a sessão) e a mesma pessoa entrando por outro computador.
 */
export function shouldReconnect(reason: DisconnectReason | undefined): boolean {
	switch (reason) {
		case DisconnectReason.CLIENT_INITIATED:
		case DisconnectReason.DUPLICATE_IDENTITY:
		case DisconnectReason.PARTICIPANT_REMOVED:
		case DisconnectReason.ROOM_DELETED:
		case DisconnectReason.ROOM_CLOSED:
		case DisconnectReason.USER_REJECTED:
		case DisconnectReason.USER_UNAVAILABLE:
			return false;
		default:
			return true;
	}
}

/** As tentativas de uma queda: quando começou e quantas já foram. */
export interface Recovery {
	startedAt: number;
	tries: number;
}

/** A próxima espera, ou `null` quando já passou dos 5 minutos e é hora de desistir. */
export function nextAttempt(
	recovery: Recovery,
	now: number,
): number | null {
	if (now - recovery.startedAt >= GIVE_UP_MS) return null;
	return reconnectDelay(recovery.tries);
}
