import { describe, expect, it } from "vitest";
import type { ChannelView, Layout } from "@/lib/api";
import { allChannels, findChannel, textChannels } from "../model/layout";

function channel(
	id: string,
	kind: ChannelView["kind"] = "text",
	category_id: string | null = null,
): ChannelView {
	return { id, kind, name: id, topic: null, category_id, archived_at: null, restricted: false };
}

const layout: Layout = {
	version: 3,
	top: [channel("avisos")],
	categories: [
		{
			id: "texto",
			name: "Texto",
			channels: [channel("geral", "text", "texto"), channel("jogos", "text", "texto")],
		},
		{ id: "voz", name: "Voz", channels: [channel("sala", "voice", "voz")] },
		{ id: "vazia", name: "Vazia", channels: [] },
	],
};

describe("layout", () => {
	it("allChannels segue a ordem da lista: o topo e depois cada categoria", () => {
		expect(allChannels(layout).map((c) => c.id)).toEqual([
			"avisos",
			"geral",
			"jogos",
			"sala",
		]);
	});

	it("textChannels deixa a sala de voz de fora", () => {
		expect(textChannels(layout).map((c) => c.id)).toEqual([
			"avisos",
			"geral",
			"jogos",
		]);
	});

	it("findChannel acha no topo e nas categorias; arquivado ou inventado não", () => {
		expect(findChannel(layout, "avisos")?.id).toBe("avisos");
		expect(findChannel(layout, "sala")?.kind).toBe("voice");
		expect(findChannel(layout, "arquivado")).toBeUndefined();
	});
});
