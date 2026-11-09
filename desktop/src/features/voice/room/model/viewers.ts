/**
 * Quem está assistindo a transmissão de quem (o "assistindo" do painel da transmissão).
 *
 * A LiveKit não conta para ninguém quem assina a trilha de outro, e a `:screen` de quem transmite
 * nem assina nada. Por isso quem assiste avisa: ao abrir o Foco, cada app manda pela conexão da
 * voz, no tópico `screen-viewers`, `{"watching": "<id de quem transmite>"}`, e ao sair,
 * `{"watching": null}`. Quem transmite junta os avisos que são para ele.
 */

export const VIEWERS_TOPIC = "screen-viewers";

export interface ViewerMessage {
	/** O id de quem a pessoa está assistindo, ou `null` ao parar. */
	watching: string | null;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeViewer(message: ViewerMessage): Uint8Array {
	return encoder.encode(JSON.stringify(message));
}

/** Uma mensagem que não é um aviso válido dá `null`. */
export function decodeViewer(payload: Uint8Array): ViewerMessage | null {
	try {
		const parsed: unknown = JSON.parse(decoder.decode(payload));
		if (typeof parsed !== "object" || parsed === null) return null;
		const { watching } = parsed as Record<string, unknown>;
		if (watching !== null && typeof watching !== "string") return null;
		return { watching };
	} catch {
		return null;
	}
}

/**
 * Os que assistem `me` depois do aviso de `from`, cada um com a hora em que começou (`now`, no
 * primeiro aviso). Devolve o mesmo mapa se nada mudou: um aviso repetido não zera a hora.
 */
export function applyViewer(
	viewers: ReadonlyMap<string, number>,
	from: string,
	message: ViewerMessage,
	me: string,
	now: number,
): ReadonlyMap<string, number> {
	const watchingMe = message.watching === me;
	if (watchingMe === viewers.has(from)) return viewers;
	const next = new Map(viewers);
	if (watchingMe) next.set(from, now);
	else next.delete(from);
	return next;
}
