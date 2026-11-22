/**
 * As menções (ADR 0022) do lado do app: achar os `@nick` de um texto com as mesmas regras da API
 * (`api/src/chat/mentions.rs`), e o que a sugestão de nicks do campo precisa.
 *
 * Quem decide quem foi mencionado é a API (`Message.mentions`). O app só procura no texto onde
 * estão os nicks dessas pessoas, para desenhar o selo: um `@` que a API não confirmou fica texto.
 */
import type { Person } from "@/lib/api";

/** Alguém que dá para mencionar. */
export type Mentionable = Pick<Person, "id" | "nick" | "display_name">;

/** Um `@nick` achado no texto: de `start` (o `@`) até `end` (fora). */
export interface MentionRange {
	start: number;
	end: number;
	person: Mentionable;
}

/** Quantas sugestões a lista mostra. */
export const PICKER_MAX = 8;

/** Até quantos caracteres depois do `@` ainda contam como o começo de um nick. */
const QUERY_MAX = 32;

/** Letra ou número, como o `is_alphanumeric` do Rust. */
const ALNUM = /[\p{L}\p{N}]/u;

/** Se depois do nick vem algo que ainda seria nick: aí é outro nome. */
function continuesNick(next: string | undefined): boolean {
	return next !== undefined && (ALNUM.test(next) || next === "_" || next === "-");
}

/**
 * Se o `@` em `at` pode começar uma menção: no começo, ou depois de espaço ou pontuação; não colado
 * numa letra, num número ou em `.`, `_`, `-`, `+`, `@` (um e-mail), nem num pedaço com `://`.
 */
export function startsMention(text: string, at: number): boolean {
	const before = text[at - 1];
	if (before !== undefined && (ALNUM.test(before) || ".-_+@".includes(before))) {
		return false;
	}
	const start = text.slice(0, at).search(/\S*$/);
	const after = text.slice(at).search(/\s/);
	const token = text.slice(start, after === -1 ? text.length : at + after);
	return !token.includes("://");
}

/**
 * Onde estão os `@nick` de `people` em `text`, na ordem. O nick é comparado sem diferenciar
 * maiúsculas, do mais comprido para o mais curto (o nick pode ter espaço e ponto), e tem de
 * terminar ali: `@ana` não é a Ana em `@anabela`.
 */
export function findMentions(
	text: string,
	people: readonly Mentionable[],
): MentionRange[] {
	if (people.length === 0 || !text.includes("@")) return [];
	const byLength = [...people].sort((a, b) => b.nick.length - a.nick.length);
	const ranges: MentionRange[] = [];
	for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
		if (!startsMention(text, at)) continue;
		const person = byLength.find((p) => {
			const end = at + 1 + p.nick.length;
			return (
				text.slice(at + 1, end).toLowerCase() === p.nick.toLowerCase() &&
				!continuesNick(text[end])
			);
		});
		if (person) {
			const end = at + 1 + person.nick.length;
			ranges.push({ start: at, end, person });
			at = end - 1;
		}
	}
	return ranges;
}

/** Sem acento e em minúsculas, para "ze" achar "Zé". */
function plain(text: string): string {
	return text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase();
}

/**
 * O que a pessoa está digitando depois de um `@`, com o cursor em `caret`: o lugar do `@` e o
 * texto até o cursor. `null` se o cursor não está num `@` que pode virar menção (sem `@` antes,
 * com quebra de linha no meio, ou longe demais).
 */
export function mentionQuery(
	text: string,
	caret: number,
): { start: number; query: string } | null {
	const before = text.slice(0, caret);
	const at = before.lastIndexOf("@");
	if (at === -1) return null;
	const query = before.slice(at + 1);
	if (query.length > QUERY_MAX || /[\n@]/.test(query) || /\s{2}|^\s/.test(query)) {
		return null;
	}
	return startsMention(text, at) ? { start: at, query } : null;
}

/**
 * As sugestões para `query`: quem tem o nick ou o nome visível começando com o texto, e depois quem
 * só contém, sem você mesmo, em ordem de nome, até `PICKER_MAX`.
 */
export function mentionOptions(
	people: readonly Mentionable[],
	query: string,
	myId: string | null,
): Mentionable[] {
	const wanted = plain(query);
	const scored = people
		.filter((p) => p.id !== myId)
		.map((p) => {
			const names = [plain(p.nick), plain(p.display_name ?? "")];
			const score = names.some((n) => n.startsWith(wanted))
				? 0
				: names.some((n) => n.includes(wanted))
					? 1
					: -1;
			return { p, score };
		})
		.filter(({ score }) => score >= 0);
	return scored
		.sort(
			(a, b) =>
				a.score - b.score || a.p.nick.localeCompare(b.p.nick, "pt-BR"),
		)
		.slice(0, PICKER_MAX)
		.map(({ p }) => p);
}

/** Troca o `@texto` em digitação por `@nick ` e diz onde o cursor fica. */
export function applyMention(
	text: string,
	start: number,
	caret: number,
	nick: string,
): { text: string; caret: number } {
	const inserted = `@${nick} `;
	const rest = text.slice(caret).replace(/^ /, "");
	return {
		text: text.slice(0, start) + inserted + rest,
		caret: start + inserted.length,
	};
}
