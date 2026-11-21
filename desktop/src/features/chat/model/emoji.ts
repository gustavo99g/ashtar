/**
 * Os emojis do seletor (ADR 0032): o `emojibase-data` em português, carregado só ao abrir o seletor
 * (um pedaço à parte do pacote do app, uns 550 KB). O texto do emoji é o `unicode` do emojibase em
 * todo lugar (o seletor e as reações rápidas), para o mesmo emoji não virar duas reações.
 */

export interface EmojiEntry {
	unicode: string;
	/** "polegar para cima". */
	label: string;
	/** O que a busca procura: o nome e as palavras-chave, sem acento e em minúsculas. */
	terms: string;
	/** O apelido do CLDR em português ("polegar_para_cima"), mostrado no rodapé. */
	shortcode: string;
}

export interface EmojiGroup {
	key: string;
	/** "Sorrisos e emoção". */
	label: string;
	emojis: EmojiEntry[];
}

interface CompactEmoji {
	group?: number;
	hexcode: string;
	label: string;
	order?: number;
	tags?: string[];
	unicode: string;
}

interface Messages {
	groups: { key: string; message: string; order: number }[];
}

/** Tira os acentos e põe em minúsculas, para "café" achar "cafe". */
export function fold(text: string): string {
	return text
		.normalize("NFD")
		.replace(/\p{Mn}/gu, "")
		.toLowerCase();
}

/** O grupo "componentes" (tons de pele, cabelo) não é emoji para reagir. */
const SKIPPED_GROUPS = new Set(["component"]);

export function buildGroups(
	compact: CompactEmoji[],
	messages: Messages,
	shortcodes: Record<string, string | string[]>,
): EmojiGroup[] {
	const byGroup = new Map<number, CompactEmoji[]>();
	for (const emoji of compact) {
		if (emoji.group === undefined) continue;
		const list = byGroup.get(emoji.group) ?? [];
		list.push(emoji);
		byGroup.set(emoji.group, list);
	}
	return messages.groups
		.filter((group) => !SKIPPED_GROUPS.has(group.key))
		.sort((a, b) => a.order - b.order)
		.map((group) => ({
			key: group.key,
			label: group.message.charAt(0).toUpperCase() + group.message.slice(1),
			emojis: (byGroup.get(group.order) ?? [])
				.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
				.map((emoji) => {
					const code = shortcodes[emoji.hexcode];
					return {
						unicode: emoji.unicode,
						label: emoji.label,
						terms: fold([emoji.label, ...(emoji.tags ?? [])].join(" ")),
						shortcode: (Array.isArray(code) ? code[0] : code) ?? emoji.label,
					};
				}),
		}))
		.filter((group) => group.emojis.length > 0);
}

let loading: Promise<EmojiGroup[]> | null = null;

/** Carrega os emojis uma vez só, na primeira abertura do seletor. */
export function loadEmojiGroups(): Promise<EmojiGroup[]> {
	loading ??= Promise.all([
		import("emojibase-data/pt/compact.json"),
		import("emojibase-data/pt/messages.json"),
		import("emojibase-data/pt/shortcodes/cldr.json"),
	])
		.then(([compact, messages, shortcodes]) =>
			buildGroups(
				compact.default as CompactEmoji[],
				messages.default as Messages,
				shortcodes.default as Record<string, string | string[]>,
			),
		)
		.catch((error: unknown) => {
			loading = null;
			throw error;
		});
	return loading;
}

/** Os emojis cujo nome ou palavra-chave começa com cada palavra de `query`, até `limit`. */
export function searchEmoji(
	groups: readonly EmojiGroup[],
	query: string,
	limit = 120,
): EmojiEntry[] {
	const words = fold(query).split(/\s+/).filter(Boolean);
	if (words.length === 0) return [];
	const found: EmojiEntry[] = [];
	for (const group of groups) {
		for (const emoji of group.emojis) {
			const terms = emoji.terms.split(/[\s:,]+/);
			if (words.every((word) => terms.some((term) => term.startsWith(word)))) {
				found.push(emoji);
				if (found.length >= limit) return found;
			}
		}
	}
	return found;
}
