import { describe, expect, it } from "vitest";
import { stageLayout } from "../model/stageLayout";

describe("o palco com várias transmissões", () => {
	it("uma ocupa o palco e fica em foco", () => {
		expect(stageLayout(["a"], null)).toEqual({
			main: ["a"],
			strip: [],
			columns: 1,
			inFocus: "a",
		});
	});

	it("duas lado a lado, três e quatro em 2×2, sem nenhuma em foco", () => {
		expect(stageLayout(["a", "b"], null)).toMatchObject({
			main: ["a", "b"],
			columns: 2,
			inFocus: null,
		});
		expect(stageLayout(["a", "b", "c", "d"], null)).toMatchObject({
			main: ["a", "b", "c", "d"],
			strip: [],
			columns: 2,
			inFocus: null,
		});
	});

	it("cinco ou mais: a primeira grande e as outras embaixo", () => {
		expect(stageLayout(["a", "b", "c", "d", "e"], null)).toEqual({
			main: ["a"],
			strip: ["b", "c", "d", "e"],
			columns: 1,
			inFocus: "a",
		});
	});

	it("a focada fica grande, com as outras embaixo, em qualquer número", () => {
		expect(stageLayout(["a", "b"], "b")).toEqual({
			main: ["b"],
			strip: ["a"],
			columns: 1,
			inFocus: "b",
		});
		expect(stageLayout(["a", "b", "c", "d", "e"], "c").main).toEqual(["c"]);
	});

	it("um foco que não está mais aberto não conta", () => {
		expect(stageLayout(["a", "b"], "z")).toMatchObject({
			main: ["a", "b"],
			inFocus: null,
		});
		expect(stageLayout([], "z")).toMatchObject({ main: [], inFocus: null });
	});
});
