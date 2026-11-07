import { afterEach, describe, expect, it } from "vitest";
import { setDraft, useDrafts } from "../stores/draftStore";

afterEach(() => {
	useDrafts.setState({ drafts: {} });
});

describe("draftStore", () => {
	it("guarda um rascunho por canal, e só espaços apaga", () => {
		setDraft("geral", "meio escrito");
		setDraft("jogos", "outro");
		expect(useDrafts.getState().drafts).toEqual({
			geral: "meio escrito",
			jogos: "outro",
		});

		setDraft("geral", "   \n ");
		expect(useDrafts.getState().drafts).toEqual({ jogos: "outro" });
	});
});
