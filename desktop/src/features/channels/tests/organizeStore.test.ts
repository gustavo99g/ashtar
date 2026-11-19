import { beforeEach, describe, expect, it } from "vitest";
import type { ChannelView, Layout } from "@/lib/api";
import { dragId, layoutRequest } from "../model/tree";
import {
	dropInDraft,
	organizeChanged,
	startOrganizing,
	stopOrganizing,
	useOrganize,
} from "../stores/organizeStore";

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

/** Topo: geral. Jogos: lol, cs. */
const layout: Layout = {
	version: 7,
	top: [text("geral")],
	categories: [
		{
			id: "jogos",
			name: "Jogos",
			channels: [text("lol", "jogos"), text("cs", "jogos")],
		},
	],
};

beforeEach(() => stopOrganizing());

describe("o modo Organizar", () => {
	it("começa desligado, e abre com uma cópia igual à árvore", () => {
		expect(useOrganize.getState().draft).toBeNull();

		startOrganizing(layout);

		const state = useOrganize.getState();
		expect(state.draft).toEqual(layout);
		expect(organizeChanged(state)).toBe(false);
	});

	it("cada soltura mexe só na cópia, que guarda a versão de quando o modo abriu", () => {
		startOrganizing(layout);

		dropInDraft(dragId.channel("cs"), dragId.channel("lol"));
		dropInDraft(dragId.channel("geral"), dragId.category("jogos"));

		const state = useOrganize.getState();
		expect(state.base).toEqual(layout);
		expect(organizeChanged(state)).toBe(true);
		expect(state.draft && layoutRequest(state.draft)).toEqual({
			version: 7,
			top: [],
			categories: [{ id: "jogos", channels: ["cs", "lol", "geral"] }],
		});
	});

	it("soltar onde não muda nada deixa a cópia como estava", () => {
		startOrganizing(layout);
		const before = useOrganize.getState().draft;

		dropInDraft(dragId.channel("lol"), dragId.channel("lol"));
		dropInDraft(dragId.category("jogos"), dragId.channel("geral"));

		expect(useOrganize.getState().draft).toBe(before);
	});

	it("voltar à ordem do começo não conta como mudança", () => {
		startOrganizing(layout);

		dropInDraft(dragId.channel("cs"), dragId.channel("lol"));
		dropInDraft(dragId.channel("lol"), dragId.channel("cs"));

		expect(organizeChanged(useOrganize.getState())).toBe(false);
	});

	it("sair joga a cópia fora, e uma soltura com o modo desligado não faz nada", () => {
		startOrganizing(layout);
		dropInDraft(dragId.channel("cs"), dragId.channel("lol"));

		stopOrganizing();
		dropInDraft(dragId.channel("cs"), dragId.channel("lol"));

		expect(useOrganize.getState()).toMatchObject({ base: null, draft: null });
	});
});
