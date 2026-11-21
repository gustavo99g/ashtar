/**
 * A busca (decisões 25 a 27 do plano da v0.7): o que a pessoa digita vira o pedido da API. Os
 * filtros são palavras com prefixo, como na menção: `de:nick`, `em:#canal` e `tem:anexo`,
 * `tem:imagem`, `tem:video` e `tem:link`. O resto são as palavras.
 */
import type { SearchHas } from "@/lib/api";

export interface SearchRequest {
	q?: string;
	author?: string;
	channelId?: string;
	has?: SearchHas;
}

/** O que vai depois de `tem:`, como a pessoa escreve. */
export const HAS_OPTIONS: readonly { word: string; has: SearchHas; label: string }[] = [
	{ word: "anexo", has: "attachment", label: "qualquer anexo" },
	{ word: "imagem", has: "image", label: "imagem" },
	{ word: "video", has: "video", label: "vídeo" },
	{ word: "link", has: "link", label: "link" },
];

/** Sem acento e em minúsculas, para comparar ("Vídeo" e "video"). */
export function fold(text: string): string {
	return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Separa os filtros das palavras. `em:#nome` vira o id do canal pelo nome; um canal que não existe
 * fica `channelId: ""` (quem usa avisa). `scope` é o canal aberto, quando a busca é só nele.
 */
export function parseSearch(
	text: string,
	channels: readonly { id: string; name: string }[],
	scope?: string,
): SearchRequest {
	const words: string[] = [];
	const request: SearchRequest = {};
	for (const token of text.split(/\s+/)) {
		if (!token) continue;
		const lower = token.toLowerCase();
		if (lower.startsWith("de:") && token.length > 3) {
			request.author = token.slice(3).replace(/^@/, "");
		} else if (lower.startsWith("em:") && token.length > 3) {
			const name = fold(token.slice(3).replace(/^#/, ""));
			request.channelId =
				channels.find((channel) => fold(channel.name) === name)?.id ?? "";
		} else if (lower.startsWith("tem:") && token.length > 4) {
			const word = fold(token.slice(4));
			const option = HAS_OPTIONS.find((o) => o.word === word);
			if (option) request.has = option.has;
			else words.push(token);
		} else {
			words.push(token);
		}
	}
	if (words.length > 0) request.q = words.join(" ");
	if (request.channelId === undefined && scope) request.channelId = scope;
	return request;
}

/** Tem o que buscar: uma palavra ou um filtro (a API recusa o pedido vazio). */
export function hasSomething(request: SearchRequest): boolean {
	return Boolean(request.q || request.author || request.has);
}

export type FilterKind = "de" | "em" | "tem";

/** O filtro sendo escrito no fim do texto (`de:an`), para as sugestões. */
export function filterAtEnd(
	text: string,
): { kind: FilterKind; partial: string; start: number } | null {
	const match = /(^|\s)(de|em|tem):(\S*)$/i.exec(text);
	if (!match) return null;
	const kind = match[2].toLowerCase() as FilterKind;
	return {
		kind,
		partial: fold(match[3].replace(/^[@#]/, "")),
		start: match.index + match[1].length,
	};
}

/** Troca o filtro do fim pelo completo, com um espaço para continuar escrevendo. */
export function completeFilter(text: string, start: number, filter: string): string {
	return `${text.slice(0, start)}${filter} `;
}

export interface Part {
	text: string;
	hit: boolean;
}

/**
 * O trecho da mensagem com as palavras destacadas: o começo de cada palavra do texto que começa
 * com uma das buscadas, sem acento (como o FTS5). Texto longo começa um pouco antes do primeiro
 * destaque, com "…".
 */
export function highlight(text: string, query: string, room = 60): Part[] {
	const words = query
		.split(/\s+/)
		.map((word) => fold(word.replace(/"/g, "")))
		.filter(Boolean);
	const hits: [number, number][] = [];
	if (words.length > 0) {
		const pattern = /[\p{L}\p{N}_]+/gu;
		for (const match of text.matchAll(pattern)) {
			const folded = fold(match[0]);
			const word = words
				.filter((w) => folded.startsWith(w))
				.sort((a, b) => b.length - a.length)[0];
			if (!word) continue;
			// O tamanho no original: as letras com acento continuam sendo uma letra.
			const length = [...match[0]].slice(0, [...word].length).join("").length;
			hits.push([match.index, match.index + length]);
		}
	}
	let from = 0;
	let prefix = "";
	if (hits.length > 0 && hits[0][0] > room) {
		const cut = text.lastIndexOf(" ", hits[0][0] - room / 2);
		from = cut > 0 ? cut + 1 : hits[0][0] - Math.floor(room / 2);
		prefix = "…";
	}
	const parts: Part[] = [];
	let at = from;
	for (const [start, end] of hits) {
		if (start < at) continue;
		if (start > at) parts.push({ text: text.slice(at, start), hit: false });
		parts.push({ text: text.slice(start, end), hit: true });
		at = end;
	}
	if (at < text.length) parts.push({ text: text.slice(at), hit: false });
	if (prefix) {
		if (parts[0] && !parts[0].hit) parts[0] = { ...parts[0], text: prefix + parts[0].text };
		else parts.unshift({ text: prefix, hit: false });
	}
	return parts;
}
