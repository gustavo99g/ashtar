/**
 * Os cartões da janela dos avisos e a pilha deles (ADR 0022, Etapa 15).
 *
 * A pilha tem no máximo [`MAX_CARDS`] cartões, o mais novo em cima. Um cartão de uma conversa (ou
 * canal, ou transmissão) que já está na tela não vira outro: o que estava é atualizado com a
 * mensagem nova, soma uma na contagem e volta para cima. Um cartão novo, com a pilha cheia, tira o
 * mais antigo.
 *
 * O cartão passa de uma janela para a outra como JSON, pelo Rust. Quem recebe confere com
 * [`parseCard`] e [`parseTarget`]: o que não tem a forma certa é ignorado.
 */
import type { SoundId } from "./decide";

export const MAX_CARDS = 3;

/** Para onde o clique no cartão leva. */
export type CardTarget =
	| { kind: "dm"; channelId: string }
	| { kind: "channel"; channelId: string }
	| { kind: "stream"; channelId: string; userId: string }
	/** O "Testar notificação": só traz a janela. */
	| { kind: "app" };

export interface CardPerson {
	nick: string;
	displayName: string | null;
}

export interface Card {
	/** Igual para tudo o que deve cair no mesmo cartão: a conversa, o canal, a transmissão. */
	key: string;
	kind: CardTarget["kind"];
	person: CardPerson;
	/** O nome de quem, em negrito. */
	title: string;
	/** "Mensagem privada", "#canal" ou "Sala". */
	context: string;
	/** O começo da mensagem, ou "começou a transmitir". */
	body: string;
	/** Quantas mensagens o cartão junta. */
	count: number;
	sound: SoundId | null;
	target: CardTarget;
	/** Muda a cada atualização: é o que reinicia o tempo do cartão na tela. */
	version: number;
}

/** O cartão como sai da janela principal: a contagem e a versão são da pilha. */
export type CardInput = Omit<Card, "count" | "version">;

/** Até quantos caracteres da mensagem aparecem no cartão. */
export const BODY_MAX = 140;

export function shortBody(body: string): string {
	const flat = body.replace(/\s+/g, " ").trim();
	return flat.length > BODY_MAX ? `${flat.slice(0, BODY_MAX - 1)}…` : flat;
}

export function cardKey(target: CardTarget): string {
	switch (target.kind) {
		case "stream":
			return `stream:${target.channelId}:${target.userId}`;
		case "app":
			return "app";
		default:
			return `${target.kind}:${target.channelId}`;
	}
}

/** Põe um cartão na pilha (o mais novo primeiro) e devolve a pilha nova. */
export function pushCard(
	cards: readonly Card[],
	input: CardInput,
	version: number,
): Card[] {
	const old = cards.find((card) => card.key === input.key);
	const card: Card = { ...input, count: (old?.count ?? 0) + 1, version };
	const others = cards.filter((other) => other.key !== input.key);
	return [card, ...others].slice(0, MAX_CARDS);
}

export function dropCard(cards: readonly Card[], key: string): Card[] {
	return cards.filter((card) => card.key !== key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

const isString = (value: unknown): value is string => typeof value === "string";

export function parseTarget(value: unknown): CardTarget | null {
	if (!isRecord(value)) return null;
	if (value.kind === "app") return { kind: "app" };
	if (!isString(value.channelId)) return null;
	const { kind, channelId } = value;
	if (kind === "dm" || kind === "channel") return { kind, channelId };
	if (kind === "stream" && isString(value.userId)) {
		return { kind, channelId, userId: value.userId };
	}
	return null;
}

export function parseCard(value: unknown): CardInput | null {
	if (!isRecord(value)) return null;
	const target = parseTarget(value.target);
	const person = value.person;
	if (
		!target ||
		!isRecord(person) ||
		!isString(person.nick) ||
		!(person.displayName === null || isString(person.displayName)) ||
		!isString(value.title) ||
		!isString(value.context) ||
		!isString(value.body)
	) {
		return null;
	}
	const sound =
		value.sound === "dm" || value.sound === "mention" ? value.sound : null;
	return {
		key: cardKey(target),
		kind: target.kind,
		person: { nick: person.nick, displayName: person.displayName },
		title: value.title,
		context: value.context,
		body: value.body,
		sound,
		target,
	};
}
