/*
 * O que o LiveKit não conta sozinho sobre os outros: quem desligou o áudio (deafen). Cada app
 * avisa os outros por mensagem de dados (confiável, no tópico abaixo) quando liga ou desliga, e
 * repete o aviso para quem entra depois enquanto estiver com o áudio desligado. O microfone e quem
 * fala vêm do próprio LiveKit.
 */

export const VOICE_STATE_TOPIC = "ashtar.voice-state";

export interface VoiceState {
	deafened: boolean;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeVoiceState(state: VoiceState): Uint8Array<ArrayBuffer> {
	return encoder.encode(JSON.stringify({ deafened: state.deafened }));
}

/** Lê o aviso de outro app. Qualquer coisa fora do formato vira `null` e é ignorada. */
export function parseVoiceState(payload: Uint8Array): VoiceState | null {
	try {
		const parsed: unknown = JSON.parse(decoder.decode(payload));
		if (typeof parsed === "object" && parsed !== null && "deafened" in parsed) {
			const { deafened } = parsed;
			if (typeof deafened === "boolean") return { deafened };
		}
	} catch {
		// Não é JSON: ignora.
	}
	return null;
}

/** O conjunto de quem está com o áudio desligado depois do aviso de `identity`. */
export function withDeafened(
	current: ReadonlySet<string>,
	identity: string,
	deafened: boolean,
): ReadonlySet<string> {
	if (current.has(identity) === deafened) return current;
	const next = new Set(current);
	if (deafened) next.add(identity);
	else next.delete(identity);
	return next;
}
