import type { CollisionDetection, DroppableContainer } from "@dnd-kit/core";
import { describe, expect, it } from "vitest";
import type { ChannelView, Layout } from "@/lib/api";
import {
	applyDrop,
	dragCollision,
	dragId,
	dropLine,
	layoutRequest,
	moveToCategory,
	sameOrder,
} from "../model/tree";

function text(id: string, category_id: string | null = null): ChannelView {
	return {
		id,
		kind: "text",
		name: id,
		topic: null,
		category_id,
		archived_at: null,
		restricted: false,
	};
}

/** Topo: geral, sala. Jogos: lol, cs. Avisos: regras. */
const layout: Layout = {
	version: 7,
	top: [text("geral"), { ...text("sala"), kind: "voice", name: "Sala" }],
	categories: [
		{
			id: "jogos",
			name: "Jogos",
			channels: [text("lol", "jogos"), text("cs", "jogos")],
		},
		{ id: "avisos", name: "Avisos", channels: [text("regras", "avisos")] },
	],
};

/** A ordem como o `PUT` manda, sem a versão: mais fácil de ler no teste. */
function order(next: Layout | null) {
	if (!next) return null;
	const { top, categories } = layoutRequest(next);
	return { top, categories };
}

describe("mover para outra categoria, pelo menu", () => {
	it("vai para o fim da categoria escolhida e troca a categoria do canal", () => {
		const next = moveToCategory(layout, "lol", "avisos");
		expect(order(next)?.categories).toEqual([
			{ id: "jogos", channels: ["cs"] },
			{ id: "avisos", channels: ["regras", "lol"] },
		]);
		expect(next?.categories[1].channels[1].category_id).toBe("avisos");
	});

	it("\"Sem categoria\" leva para o fim do topo", () => {
		const next = moveToCategory(layout, "cs", null);
		expect(order(next)?.top).toEqual(["geral", "sala", "cs"]);
		expect(next?.top[2].category_id).toBeNull();
	});

	it("sai do topo para uma categoria", () => {
		expect(
			order(moveToCategory(layout, "geral", "jogos"))?.categories[0].channels,
		).toEqual(["lol", "cs", "geral"]);
	});

	it("não há o que gravar se ele já está lá, ou se o canal ou a categoria não existem", () => {
		expect(moveToCategory(layout, "lol", "jogos")).toBeNull();
		expect(moveToCategory(layout, "geral", null)).toBeNull();
		expect(moveToCategory(layout, "lol", "sumiu")).toBeNull();
		expect(moveToCategory(layout, "sumiu", "jogos")).toBeNull();
	});
});

describe("soltar depois de arrastar", () => {
	it("um canal em cima de outro toma o lugar dele, mesmo em outra categoria", () => {
		const next = applyDrop(
			layout,
			dragId.channel("geral"),
			dragId.channel("regras"),
		);
		expect(order(next)).toEqual({
			top: ["sala"],
			categories: [
				{ id: "jogos", channels: ["lol", "cs"] },
				{ id: "avisos", channels: ["geral", "regras"] },
			],
		});
	});

	it("em cima do nome da categoria vai para o fim dela; no fim do topo, sai da categoria", () => {
		expect(
			order(
				applyDrop(layout, dragId.channel("regras"), dragId.category("jogos")),
			)?.categories[0].channels,
		).toEqual(["lol", "cs", "regras"]);
		expect(
			order(applyDrop(layout, dragId.channel("lol"), dragId.top))?.top,
		).toEqual(["geral", "sala", "lol"]);
	});

	it("uma categoria só se solta em cima de outra categoria", () => {
		expect(
			order(
				applyDrop(layout, dragId.category("avisos"), dragId.category("jogos")),
			)?.categories.map((c) => c.id),
		).toEqual(["avisos", "jogos"]);
		expect(
			applyDrop(layout, dragId.category("avisos"), dragId.channel("geral")),
		).toBeNull();
		expect(
			applyDrop(layout, dragId.channel("lol"), dragId.channel("lol")),
		).toBeNull();
	});

	it("o pedido leva a versão que o app viu, e soltar no mesmo lugar não muda a ordem", () => {
		const next = applyDrop(
			layout,
			dragId.channel("cs"),
			dragId.category("jogos"),
		);
		expect(next && layoutRequest(next).version).toBe(7);
		expect(next && sameOrder(layout, next)).toBe(true);
	});
});

describe("a linha de onde vai cair", () => {
	const ch = dragId.channel;
	const cat = dragId.category;

	it("um canal em cima de outro: a linha fica onde ele vai entrar", () => {
		// De outra lista, toma o lugar do alvo: a linha fica antes dele.
		expect(dropLine(layout, ch("regras"), ch("cs"))).toEqual({
			id: ch("cs"),
			edge: "before",
		});
		// Para baixo na mesma lista, vai para depois do alvo, que era o último.
		expect(dropLine(layout, ch("lol"), ch("cs"))).toEqual({
			id: ch("cs"),
			edge: "after",
		});
		// Para cima na mesma lista, antes do alvo.
		expect(dropLine(layout, ch("cs"), ch("lol"))).toEqual({
			id: ch("lol"),
			edge: "before",
		});
	});

	it("no nome da categoria ou no fim do topo: depois do último canal de lá", () => {
		expect(dropLine(layout, ch("geral"), cat("jogos"))).toEqual({
			id: ch("cs"),
			edge: "after",
		});
		expect(dropLine(layout, ch("lol"), dragId.top)).toEqual({
			id: ch("sala"),
			edge: "after",
		});
	});

	it("numa categoria vazia, logo depois do nome dela", () => {
		const empty: Layout = {
			...layout,
			categories: [
				...layout.categories,
				{ id: "vazia", name: "Vazia", channels: [] },
			],
		};
		expect(dropLine(empty, ch("lol"), cat("vazia"))).toEqual({
			id: cat("vazia"),
			edge: "after",
		});
	});

	it("uma categoria: antes da que fica embaixo, ou depois da de cima", () => {
		expect(dropLine(layout, cat("avisos"), cat("jogos"))).toEqual({
			id: cat("jogos"),
			edge: "before",
		});
		expect(dropLine(layout, cat("jogos"), cat("avisos"))).toEqual({
			id: cat("avisos"),
			edge: "after",
		});
	});

	it("sem linha quando soltar não muda nada", () => {
		expect(dropLine(layout, ch("lol"), ch("lol"))).toBeNull();
		// O `cs` já é o último de Jogos.
		expect(dropLine(layout, ch("cs"), cat("jogos"))).toBeNull();
		expect(dropLine(layout, cat("jogos"), ch("regras"))).toBeNull();
	});
});

describe("dragCollision", () => {
	/** Um retângulo de 100 x 40 com o canto de cima em `top`. */
	function rect(top: number) {
		return {
			top,
			left: 0,
			right: 100,
			bottom: top + 40,
			width: 100,
			height: 40,
		};
	}

	/** Quem o arrastar aponta quando `active` está com o centro na altura 120. */
	function hit(active: string): string[] {
		const targets = {
			// O canal está exatamente embaixo do que se arrasta; a categoria, mais longe.
			[dragId.channel("lol")]: rect(100),
			[dragId.category("jogos")]: rect(300),
			[dragId.category("avisos")]: rect(500),
		};
		const args = {
			active: { id: active },
			collisionRect: rect(100),
			droppableRects: new Map(Object.entries(targets)),
			droppableContainers: Object.keys(targets).map((id) => ({ id })),
			pointerCoordinates: null,
		} as unknown as Parameters<CollisionDetection>[0] & {
			droppableContainers: DroppableContainer[];
		};
		return dragCollision(args).map((collision) => String(collision.id));
	}

	it("um canal arrastado pode apontar para outro canal, para uma categoria ou para o topo", () => {
		expect(hit(dragId.channel("cs"))[0]).toBe(dragId.channel("lol"));
	});

	it("uma categoria arrastada só enxerga outras categorias, nunca os canais", () => {
		const ids = hit(dragId.category("avisos"));
		expect(ids).not.toContain(dragId.channel("lol"));
		expect(ids[0]).toBe(dragId.category("jogos"));
	});
});
