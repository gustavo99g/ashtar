/**
 * O lado da janela principal do contrato do cartão da ligação com a janela dos avisos (o outro lado
 * é o `model/ring.ts` da `features/notifications`): o cartão que vai e a resposta que volta, como
 * JSON pelo Rust. Duas cópias pequenas, em vez de uma feature importar a outra.
 */
import type { CallView } from "@/lib/api";

/** O cartão que vai para a janela dos avisos. */
export function ringCard(
	call: CallView,
	where: { inRoom: boolean; sharing: boolean },
) {
	return {
		callId: call.id,
		channelId: call.channel_id,
		person: { nick: call.caller.nick, displayName: call.caller.display_name },
		inRoom: where.inRoom,
		sharing: where.sharing,
	};
}

export type RingAction = "accept" | "decline" | "reply";

export interface RingAnswer {
	callId: string;
	action: RingAction;
}

/** A resposta que volta de um botão do cartão; `null` se não tem a forma certa. */
export function parseAnswer(value: unknown): RingAnswer | null {
	if (typeof value !== "object" || value === null) return null;
	const { callId, action } = value as Record<string, unknown>;
	if (typeof callId !== "string") return null;
	if (action !== "accept" && action !== "decline" && action !== "reply") {
		return null;
	}
	return { callId, action };
}
