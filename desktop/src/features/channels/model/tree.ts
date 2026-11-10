/**
 * As mudanças de ordem da lista, sem React: mover um canal para outra categoria (pelo menu) ou
 * arrastar um canal ou uma categoria (no modo Organizar) devolve a lista nova, que vira o
 * `PUT /api/channels/layout`.
 *
 * Um "lugar" de canal é o topo (`null`) ou uma categoria (o id).
 */
import { type CollisionDetection, closestCenter } from "@dnd-kit/core";
import type { ChannelView, Layout, LayoutRequest } from "@/lib/api";

/** Os ids que o arrastar usa. Prefixados: um canal e uma categoria nunca se confundem. */
export const dragId = {
	channel: (id: string) => `ch:${id}`,
	category: (id: string) => `cat:${id}`,
	/** O fim do topo, onde se solta um canal para tirá-lo da categoria. */
	top: "top",
};

export type DragTarget =
	| { kind: "channel"; id: string }
	| { kind: "category"; id: string }
	| { kind: "top" };

/**
 * Para onde o arrastar aponta: o alvo mais perto do centro. Uma categoria só se solta em cima de
 * outra categoria (`applyDrop`), então ao arrastar uma categoria os canais nem entram na disputa.
 * Sem isso, o alvo mais perto seria quase sempre um canal da categoria de baixo, e soltar não
 * faria nada.
 */
export const dragCollision: CollisionDetection = (args) => {
	const draggingCategory =
		parseDragId(String(args.active.id))?.kind === "category";
	return closestCenter({
		...args,
		droppableContainers: draggingCategory
			? args.droppableContainers.filter(
					(container) => parseDragId(String(container.id))?.kind === "category",
				)
			: args.droppableContainers,
	});
};

export function parseDragId(value: string): DragTarget | null {
	if (value === dragId.top) return { kind: "top" };
	if (value.startsWith("ch:")) return { kind: "channel", id: value.slice(3) };
	if (value.startsWith("cat:")) return { kind: "category", id: value.slice(4) };
	return null;
}

/** O pedido do `PUT` com a ordem desta lista. */
export function layoutRequest(layout: Layout): LayoutRequest {
	return {
		version: layout.version,
		top: layout.top.map((c) => c.id),
		categories: layout.categories.map((category) => ({
			id: category.id,
			channels: category.channels.map((c) => c.id),
		})),
	};
}

/** Os lugares em ordem: o topo e cada categoria, com a lista de canais de cada um. */
function places(
	layout: Layout,
): { id: string | null; channels: ChannelView[] }[] {
	return [
		{ id: null, channels: layout.top },
		...layout.categories.map((c) => ({ id: c.id, channels: c.channels })),
	];
}

function rebuild(
	layout: Layout,
	lists: { id: string | null; channels: ChannelView[] }[],
): Layout {
	const withCategory = (channels: ChannelView[], id: string | null) =>
		channels.map((c) => ({ ...c, category_id: id }));
	return {
		...layout,
		top: withCategory(lists[0].channels, null),
		categories: layout.categories.map((category, index) => ({
			...category,
			channels: withCategory(lists[index + 1].channels, category.id),
		})),
	};
}

/** Tira o canal de onde está e põe no lugar `place`, na posição `index`. */
export function placeChannel(
	layout: Layout,
	channelId: string,
	place: string | null,
	index: number,
): Layout {
	const lists = places(layout).map((p) => ({
		...p,
		channels: [...p.channels],
	}));
	const from = lists.find((p) => p.channels.some((c) => c.id === channelId));
	const to = lists.find((p) => p.id === place);
	if (!from || !to) return layout;
	const at = from.channels.findIndex((c) => c.id === channelId);
	const [channel] = from.channels.splice(at, 1);
	to.channels.splice(
		Math.max(0, Math.min(index, to.channels.length)),
		0,
		channel,
	);
	return rebuild(layout, lists);
}

/**
 * O "Mover para" do menu do canal: leva o canal para o fim da categoria `categoryId`, ou do topo
 * (`null`). `null` se ele já está lá, se a categoria não existe ou se o canal não existe: aí não há
 * o que gravar.
 */
export function moveToCategory(
	layout: Layout,
	channelId: string,
	categoryId: string | null,
): Layout | null {
	const lists = places(layout);
	const from = lists.find((p) => p.channels.some((c) => c.id === channelId));
	const to = lists.find((p) => p.id === categoryId);
	if (!from || !to || from.id === to.id) return null;
	return placeChannel(layout, channelId, to.id, to.channels.length);
}

/**
 * Onde o arrastar soltou: um canal em cima de outro canal toma o lugar dele; em cima do nome de uma
 * categoria, vai para o fim dela; no fim do topo, para o fim do topo. Uma categoria em cima de outra
 * toma o lugar dela.
 */
export function applyDrop(
	layout: Layout,
	active: string,
	over: string,
): Layout | null {
	const from = parseDragId(active);
	const to = parseDragId(over);
	if (!from || !to || active === over) return null;

	if (from.kind === "category") {
		if (to.kind !== "category") return null;
		const index = layout.categories.findIndex((c) => c.id === from.id);
		const target = layout.categories.findIndex((c) => c.id === to.id);
		if (index < 0 || target < 0) return null;
		return reorderCategory(layout, index, target);
	}
	if (from.kind !== "channel") return null;

	if (to.kind === "top")
		return placeChannel(layout, from.id, null, layout.top.length);
	if (to.kind === "category") {
		const category = layout.categories.find((c) => c.id === to.id);
		if (!category) return null;
		return placeChannel(layout, from.id, category.id, category.channels.length);
	}
	const place = places(layout).find((p) =>
		p.channels.some((c) => c.id === to.id),
	);
	if (!place) return null;
	const index = place.channels.findIndex((c) => c.id === to.id);
	return placeChannel(layout, from.id, place.id, index);
}

/** Onde desenhar a linha de "vai cair aqui": numa das bordas da linha de id `id`. */
export interface DropLine {
	/** O `dragId` do canal, da categoria ou do topo que serve de referência. */
	id: string;
	edge: "before" | "after";
}

/**
 * A linha que mostra onde o arrastado vai cair se for solto agora. Sai do próprio `applyDrop`: faz a
 * soltura numa cópia e olha quem ficou de vizinho, então a linha nunca promete um lugar diferente do
 * que a soltura dá. `null` se soltar ali não muda nada.
 *
 * Canal: antes do canal que ficaria embaixo dele; se ficaria por último, depois do de cima; numa
 * categoria vazia (ou no topo vazio), depois do nome dela. Categoria: antes da categoria de baixo,
 * ou depois da de cima.
 */
export function dropLine(
	layout: Layout,
	active: string,
	over: string,
): DropLine | null {
	const next = applyDrop(layout, active, over);
	const from = parseDragId(active);
	if (!next || !from || sameOrder(layout, next)) return null;

	if (from.kind === "category") {
		const index = next.categories.findIndex((c) => c.id === from.id);
		const below = next.categories[index + 1];
		if (below) return { id: dragId.category(below.id), edge: "before" };
		const above = next.categories[index - 1];
		return above ? { id: dragId.category(above.id), edge: "after" } : null;
	}
	if (from.kind !== "channel") return null;

	const place = places(next).find((p) =>
		p.channels.some((c) => c.id === from.id),
	);
	if (!place) return null;
	const index = place.channels.findIndex((c) => c.id === from.id);
	const below = place.channels[index + 1];
	if (below) return { id: dragId.channel(below.id), edge: "before" };
	const above = place.channels[index - 1];
	if (above) return { id: dragId.channel(above.id), edge: "after" };
	return {
		id: place.id === null ? dragId.top : dragId.category(place.id),
		edge: "after",
	};
}

function reorderCategory(
	layout: Layout,
	index: number,
	target: number,
): Layout {
	const categories = [...layout.categories];
	const [category] = categories.splice(index, 1);
	categories.splice(target, 0, category);
	return { ...layout, categories };
}

/** Se as duas listas têm a mesma ordem (aí não precisa mandar nada). */
export function sameOrder(a: Layout, b: Layout): boolean {
	return JSON.stringify(layoutRequest(a)) === JSON.stringify(layoutRequest(b));
}
