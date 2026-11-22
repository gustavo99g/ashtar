/**
 * Quem está assistindo a transmissão de quem: o "assistindo" do painel de quem transmite e os
 * avatares de quem assiste em cada transmissão, para todos (ADR 0024).
 *
 * A LiveKit não conta para ninguém quem assina a trilha de outro, e a `:screen` de quem transmite
 * nem assina nada. Por isso quem assiste avisa: cada app manda pela conexão da voz, no tópico
 * `screen-viewers`, a lista das transmissões que tem à vista (`{"watching": ["id-1", "id-2"]}`), para
 * a sala inteira, a cada mudança e de novo para quem entra. Cada app junta os avisos numa tabela.
 *
 * A 0.3 mandava uma transmissão só (`{"watching": "id"}`, ou `null` ao parar), e esse formato
 * continua sendo lido enquanto alguém estiver nela.
 */

export const VIEWERS_TOPIC = "screen-viewers";

export interface ViewerMessage {
	/** Os ids de quem transmite que a pessoa está assistindo; vazio ao parar. */
	watching: readonly string[];
}

/** Por quem assiste: de quem é cada transmissão que essa pessoa assiste, e desde quando. */
export type WatchTable = ReadonlyMap<string, ReadonlyMap<string, number>>;

export const EMPTY_TABLE: WatchTable = new Map();

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeViewer(message: ViewerMessage): Uint8Array {
	return encoder.encode(JSON.stringify({ watching: [...message.watching] }));
}

/** Uma mensagem que não é um aviso válido dá `null`. Lê também o formato da 0.3. */
export function decodeViewer(payload: Uint8Array): ViewerMessage | null {
	try {
		const parsed: unknown = JSON.parse(decoder.decode(payload));
		if (typeof parsed !== "object" || parsed === null) return null;
		const { watching } = parsed as Record<string, unknown>;
		if (watching === null) return { watching: [] };
		if (typeof watching === "string") return { watching: [watching] };
		if (
			Array.isArray(watching) &&
			watching.every((id): id is string => typeof id === "string")
		) {
			return { watching };
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * A tabela depois do aviso de `from`: as transmissões que ele continua assistindo guardam a hora
 * de antes; as novas ganham `now`. Devolve a mesma tabela se nada mudou: um aviso repetido não zera
 * a hora.
 */
export function applyViewer(
	table: WatchTable,
	from: string,
	message: ViewerMessage,
	now: number,
): WatchTable {
	const before = table.get(from) ?? new Map<string, number>();
	const wanted = new Set(message.watching.filter((id) => id !== from));
	const same =
		wanted.size === before.size && [...wanted].every((id) => before.has(id));
	if (same) return table;
	const next = new Map(table);
	if (wanted.size === 0) {
		next.delete(from);
	} else {
		next.set(
			from,
			new Map([...wanted].map((id) => [id, before.get(id) ?? now])),
		);
	}
	return next;
}

/** A tabela sem `from` (ele saiu da sala). */
export function removeViewer(table: WatchTable, from: string): WatchTable {
	if (!table.has(from)) return table;
	const next = new Map(table);
	next.delete(from);
	return next;
}

/** Quem assiste a transmissão de `owner`, cada um com a hora em que começou. */
export function viewersOf(
	table: WatchTable,
	owner: string,
): ReadonlyMap<string, number> {
	const viewers = new Map<string, number>();
	for (const [viewer, watched] of table) {
		const since = watched.get(owner);
		if (since !== undefined) viewers.set(viewer, since);
	}
	return viewers;
}
