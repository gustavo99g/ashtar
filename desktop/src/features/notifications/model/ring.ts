/**
 * O cartão da ligação recebida (ADR 0023, Etapa 20 da v0.3): o que a janela principal manda para a
 * janela dos avisos enquanto toca, e a resposta que volta quando a pessoa aperta um botão.
 *
 * Como os outros cartões, passa como JSON pelo Rust; quem recebe confere com [`parseRing`] (e,
 * na janela principal, o `model/ring.ts` da `features/calls` confere a resposta).
 */
import type { CardPerson } from "./cards";

export interface RingCard {
	callId: string;
	/** A conversa: é para onde o Responder com mensagem leva. */
	channelId: string;
	person: CardPerson;
	/** Quem recebe está numa sala: o botão vira "Sair e atender", e o toque é mais baixo. */
	inRoom: boolean;
	/** Quem recebe está transmitindo: atender encerra a transmissão, e o cartão avisa. */
	sharing: boolean;
}

export type RingAction = "accept" | "decline" | "reply";

export interface RingAnswer {
	callId: string;
	action: RingAction;
}

/** O volume do toque: mais baixo para quem está ouvindo uma sala. */
export const RING_VOLUME = 0.8;
export const RING_VOLUME_IN_ROOM = 0.3;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

const isString = (value: unknown): value is string => typeof value === "string";

export function parseRing(value: unknown): RingCard | null {
	if (!isRecord(value) || !isRecord(value.person)) return null;
	const { person } = value;
	if (
		!isString(value.callId) ||
		!isString(value.channelId) ||
		!isString(person.nick) ||
		!(person.displayName === null || isString(person.displayName))
	) {
		return null;
	}
	return {
		callId: value.callId,
		channelId: value.channelId,
		person: { nick: person.nick, displayName: person.displayName },
		inRoom: value.inRoom === true,
		sharing: value.sharing === true,
	};
}
