import { beforeEach, describe, expect, it } from "vitest";
import {
	clearOpenDms,
	closeDm,
	MAX_OPEN,
	minimizeDm,
	showDm,
	useOpenDms,
} from "../stores/openDmsStore";

beforeEach(() => {
	localStorage.clear();
	clearOpenDms();
});

describe("as conversas abertas", () => {
	it("abrir expande e põe na frente; abrir de novo não repete", () => {
		showDm("a");
		showDm("b");
		showDm("a");
		expect(useOpenDms.getState()).toEqual({ open: ["a", "b"], active: "a" });
	});

	it("minimizar mantém aberta; fechar tira, e a expandida deixa de ser ela", () => {
		showDm("a");
		showDm("b");
		minimizeDm();
		expect(useOpenDms.getState()).toEqual({ open: ["b", "a"], active: null });
		showDm("a");
		closeDm("b");
		expect(useOpenDms.getState()).toEqual({ open: ["a"], active: "a" });
		closeDm("a");
		expect(useOpenDms.getState()).toEqual({ open: [], active: null });
	});

	it("passando do máximo, a mais antiga fecha", () => {
		for (let i = 0; i <= MAX_OPEN; i += 1) showDm(`d${i}`);
		const { open } = useOpenDms.getState();
		expect(open).toHaveLength(MAX_OPEN);
		expect(open).not.toContain("d0");
	});

	it("vai para o disco, e um valor estranho volta para o padrão", async () => {
		showDm("a");
		expect(localStorage.getItem("ashtar-open-dms")).toContain('"active":"a"');
		localStorage.setItem(
			"ashtar-open-dms",
			JSON.stringify({ state: { open: ["a", 7], active: "z" }, version: 1 }),
		);
		await useOpenDms.persist.rehydrate();
		expect(useOpenDms.getState()).toEqual({ open: ["a"], active: null });
	});
});
