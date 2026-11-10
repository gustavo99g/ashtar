import type { CollisionDetection, DroppableContainer } from "@dnd-kit/core";
import { describe, expect, it } from "vitest";
import type { ChannelView, Layout } from "@/lib/api";
import {
	applyDrop,
	dragCollision,
	dragId,
	layoutRequest,
	moveCategory,
	moveChannel,
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

describe("mover pelo menu", () => {
	it("sobe e desce dentro do mesmo lugar", () => {
		expect(
			order(moveChannel(layout, "cs", -1))?.categories[0].channels,
		).toEqual(["cs", "lol"]);
		expect(order(moveChannel(layout, "geral", 1))?.top).toEqual([
			"sala",
			"geral",
		]);
	});

	it("na ponta, passa para o lugar vizinho e troca a categoria do canal", () => {
		const up = moveChannel(layout, "lol", -1);
		expect(order(up)?.top).toEqual(["geral", "sala", "lol"]);
		expect(up?.top[2].category_id).toBeNull();

		const down = moveChannel(layout, "cs", 1);
		expect(order(down)?.categories[1].channels).toEqual(["cs", "regras"]);
		expect(down?.categories[1].channels[0].category_id).toBe("avisos");
	});

	it("o primeiro do topo não sobe e o último da lista não desce", () => {
		expect(moveChannel(layout, "geral", -1)).toBeNull();
		expect(moveChannel(layout, "regras", 1)).toBeNull();
	});

	it("categoria sobe e desce, mas não passa das pontas", () => {
		expect(
			order(moveCategory(layout, "avisos", -1))?.categories.map((c) => c.id),
		).toEqual(["avisos", "jogos"]);
		expect(moveCategory(layout, "jogos", -1)).toBeNull();
		expect(moveCategory(layout, "avisos", 1)).toBeNull();
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
