/**
 * As mudanças de ordem da lista, sem React: mover um canal ou uma categoria (pelo menu ou
 * arrastando) devolve a lista nova, que vira o `PUT /api/channels/layout`.
 *
 * Um "lugar" de canal é o topo (`null`) ou uma categoria (o id). Mover para cima no primeiro canal
 * de um lugar leva para o fim do lugar de cima; para baixo no último, para o começo do de baixo.
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

/** Um passo para cima (`-1`) ou para baixo (`1`), passando de um lugar para o vizinho na ponta. */
export function moveChannel(
	layout: Layout,
	channelId: string,
	step: -1 | 1,
): Layout | null {
	const lists = places(layout);
	const placeIndex = lists.findIndex((p) =>
		p.channels.some((c) => c.id === channelId),
	);
	if (placeIndex < 0) return null;
	const place = lists[placeIndex];
	const index = place.channels.findIndex((c) => c.id === channelId);
	const target = index + step;
	if (target >= 0 && target < place.channels.length) {
		return placeChannel(layout, channelId, place.id, target);
	}
	const neighbour = lists[placeIndex + step];
	if (!neighbour) return null;
	return placeChannel(
		layout,
		channelId,
		neighbour.id,
		step === -1 ? neighbour.channels.length : 0,
	);
}

/** Uma categoria um passo para cima ou para baixo. */
export function moveCategory(
	layout: Layout,
	categoryId: string,
	step: -1 | 1,
): Layout | null {
	const index = layout.categories.findIndex((c) => c.id === categoryId);
	const target = index + step;
	if (index < 0 || target < 0 || target >= layout.categories.length)
		return null;
	return reorderCategory(layout, index, target);
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
