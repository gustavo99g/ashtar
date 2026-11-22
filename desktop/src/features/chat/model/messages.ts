/**
 * As regras do texto (as mesmas da API, para avisar antes de mandar) e o jeito de desenhar a
 * conversa: grupos por autor, separador de dia e a hora.
 */
import type { Author, Message } from "@/lib/api";
import { findMentions, type Mentionable } from "./mentions";

export const BODY_MAX = 2000;
/** Quebras de linha seguidas que ainda valem. */
export const MAX_BLANK_RUN = 5;
/** A partir de quantos caracteres o campo mostra a contagem. */
export const COUNTER_FROM = 1800;
/** Mensagens do mesmo autor com até este intervalo entre elas ficam num grupo só. */
export const GROUP_GAP_SECONDS = 5 * 60;

/** O motivo de um texto não poder ser mandado, ou `null` se pode. Igual à API. */
export function draftProblem(body: string): string | null {
	const text = body.trim();
	if (text.length === 0) return "Escreva alguma coisa.";
	if ([...text].length > BODY_MAX) return `Até ${BODY_MAX} caracteres.`;
	if (text.includes("\n".repeat(MAX_BLANK_RUN + 1))) {
		return `No máximo ${MAX_BLANK_RUN} linhas em branco seguidas.`;
	}
	return null;
}

/** O nome que aparece: o nome visível ou, sem ele, o nick. */
export function authorName(author: Pick<Author, "nick" | "display_name">) {
	return author.display_name?.trim() || author.nick;
}

/** Uma linha da conversa já pronta para desenhar. */
export interface ConversationRow {
	message: Message;
	/** Começa um grupo: mostra avatar, nome e hora. */
	startsGroup: boolean;
	/** O dia mudou: desenha o separador antes ("Hoje", "Ontem", "29 de outubro"). */
	day: string | null;
}

function dayKey(seconds: number): string {
	const date = new Date(seconds * 1000);
	return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Monta as linhas: grupo novo quando muda o autor, passa de 5 minutos ou muda o dia, em volta do
 * registro de uma ligação, e numa resposta (a citação fica em cima do nome).
 */
export function conversationRows(
	messages: Message[],
	now = new Date(),
): ConversationRow[] {
	let previous: Message | null = null;
	return messages.map((message) => {
		const newDay =
			previous === null ||
			dayKey(previous.created_at) !== dayKey(message.created_at);
		const startsGroup =
			newDay ||
			previous === null ||
			previous.author.id !== message.author.id ||
			// O registro de uma ligação é uma linha à parte: não entra no grupo de ninguém.
			previous.kind === "call" ||
			message.kind === "call" ||
			message.reply_to !== null ||
			message.created_at - previous.created_at > GROUP_GAP_SECONDS;
		previous = message;
		return {
			message,
			startsGroup,
			day: newDay ? dayLabel(message.created_at, now) : null,
		};
	});
}

const TIME = new Intl.DateTimeFormat("pt-BR", {
	hour: "2-digit",
	minute: "2-digit",
});
const DAY = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long" });
const DAY_YEAR = new Intl.DateTimeFormat("pt-BR", {
	day: "numeric",
	month: "long",
	year: "numeric",
});

/** "21:35". */
export function timeLabel(seconds: number): string {
	return TIME.format(new Date(seconds * 1000));
}

/** A hora ao lado do nome, como no quadro: "Hoje às 09:14", "Ontem às 21:03", "29 de outubro às 10:00". */
export function stampLabel(seconds: number, now = new Date()): string {
	return `${dayLabel(seconds, now)} às ${timeLabel(seconds)}`;
}

/** "Hoje", "Ontem", "29 de outubro" e, de outro ano, "29 de outubro de 2025". */
export function dayLabel(seconds: number, now = new Date()): string {
	const date = new Date(seconds * 1000);
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const that = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	const days = Math.round((today.getTime() - that.getTime()) / 86_400_000);
	if (days === 0) return "Hoje";
	if (days === 1) return "Ontem";
	return date.getFullYear() === now.getFullYear()
		? DAY.format(date)
		: DAY_YEAR.format(date);
}

/** Um pedaço do texto: texto comum, um link ou uma menção. */
export type BodyPart =
	| { kind: "text"; text: string }
	| { kind: "link"; url: string }
	| { kind: "mention"; text: string; person: Mentionable };

/** Pontuação que costuma colar no fim do link sem fazer parte dele ("veja https://x.com."). */
const TRAILING = new Set([
	".",
	",",
	";",
	":",
	"!",
	"?",
	")",
	"]",
	"}",
	"'",
	'"',
]);
const OPENING: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

function count(text: string, char: string): number {
	return text.split(char).length - 1;
}

/**
 * Tira do fim do link a pontuação que não é dele. Um `)` só sai se não fecha um `(` do próprio
 * link: `https://pt.wikipedia.org/wiki/Rust_(linguagem)` fica inteiro, e o `)` de "(veja
 * https://x.com)" sai.
 */
function trimTrailing(url: string): string {
	let end = url.length;
	while (end > 0 && TRAILING.has(url[end - 1])) {
		const char = url[end - 1];
		const opening = OPENING[char];
		const kept = url.slice(0, end);
		if (opening && count(kept, opening) >= count(kept, char)) break;
		end -= 1;
	}
	return url.slice(0, end);
}

/**
 * Separa os links `http(s)://` e as menções do resto, para virarem clicáveis e selos. Só vira
 * menção o `@nick` de quem está em `mentioned` (quem a API confirmou); o resto fica texto.
 */
export function bodyParts(
	body: string,
	mentioned: readonly Mentionable[] = [],
): BodyPart[] {
	const parts: BodyPart[] = [];
	const pattern = /https?:\/\/[^\s<>]+/gi;
	let last = 0;
	const pushText = (end: number) => {
		if (end <= last) return;
		const text = body.slice(last, end);
		let cursor = 0;
		for (const range of findMentions(text, mentioned)) {
			if (range.start > cursor) {
				parts.push({ kind: "text", text: text.slice(cursor, range.start) });
			}
			parts.push({
				kind: "mention",
				text: text.slice(range.start, range.end),
				person: range.person,
			});
			cursor = range.end;
		}
		if (cursor < text.length) parts.push({ kind: "text", text: text.slice(cursor) });
	};
	for (const match of body.matchAll(pattern)) {
		const url = trimTrailing(match[0]);
		pushText(match.index);
		parts.push({ kind: "link", url });
		last = match.index + url.length;
	}
	pushText(body.length);
	return parts;
}
