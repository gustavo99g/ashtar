/**
 * O `:nome:` dos emojis do grupo no texto (decisão 31 do plano da v0.7): vira a imagem quando o
 * emoji existe; um que não existe (ou foi excluído) continua como texto.
 */

const TOKEN = /:([a-z0-9_]{2,32}):/g;

export type EmojiPart<T> =
	| { kind: "text"; text: string }
	| { kind: "emoji"; emoji: T };

export function emojiParts<T>(
	text: string,
	byName: ReadonlyMap<string, T>,
): EmojiPart<T>[] {
	if (byName.size === 0 || !text.includes(":")) return [{ kind: "text", text }];
	const parts: EmojiPart<T>[] = [];
	let at = 0;
	for (const match of text.matchAll(TOKEN)) {
		const emoji = byName.get(match[1]);
		if (!emoji) continue;
		if (match.index > at) parts.push({ kind: "text", text: text.slice(at, match.index) });
		parts.push({ kind: "emoji", emoji });
		at = match.index + match[0].length;
	}
	if (at < text.length) parts.push({ kind: "text", text: text.slice(at) });
	return parts;
}

/** A mensagem é só emojis do grupo (até 27, como no Discord): eles aparecem maiores. */
export function onlyCustomEmojis(
	body: string,
	byName: ReadonlyMap<string, unknown>,
): boolean {
	const trimmed = body.trim();
	if (!trimmed || byName.size === 0) return false;
	let count = 0;
	const rest = trimmed.replace(TOKEN, (token, name: string) => {
		if (!byName.has(name)) return token;
		count += 1;
		return "";
	});
	return count > 0 && count <= 27 && rest.trim() === "";
}

/** O `:nom` sendo escrito antes do cursor: onde começa (o `:`) e o que vem depois. */
export function emojiQuery(
	text: string,
	caret: number,
): { start: number; query: string } | null {
	const match = /(^|[\s(]):([a-z0-9_]{1,32})$/i.exec(text.slice(0, caret));
	if (!match) return null;
	return { start: match.index + match[1].length, query: match[2].toLowerCase() };
}

/** Os emojis do grupo para `query`: os que começam com ela primeiro, depois os que a contêm. */
export function emojiOptions<T extends { name: string }>(
	emojis: readonly T[],
	query: string,
	limit = 8,
): T[] {
	const starts = emojis.filter((emoji) => emoji.name.startsWith(query));
	const contains = emojis.filter(
		(emoji) => !emoji.name.startsWith(query) && emoji.name.includes(query),
	);
	return [...starts, ...contains].slice(0, limit);
}

/** Troca o `:nom` (de `start` até o cursor) por `:nome: `. */
export function applyEmoji(
	text: string,
	start: number,
	caret: number,
	name: string,
): { text: string; caret: number } {
	const inserted = `:${name}: `;
	return {
		text: text.slice(0, start) + inserted + text.slice(caret),
		caret: start + inserted.length,
	};
}
