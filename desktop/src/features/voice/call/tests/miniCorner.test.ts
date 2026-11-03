import { beforeEach, describe, expect, it } from "vitest";
import { clampToArea, nearestCorner } from "../model/miniCorner";
import { setMiniCorner, useMiniShare } from "../stores/miniShareStore";

const area = { width: 1000, height: 600 };

describe("o canto da miniatura", () => {
	beforeEach(() => {
		localStorage.clear();
		useMiniShare.setState({ corner: "bottom-right" });
	});

	it("solta, vai para o canto da metade em que o centro caiu", () => {
		expect(nearestCorner({ x: 100, y: 100 }, area)).toBe("top-left");
		expect(nearestCorner({ x: 900, y: 100 }, area)).toBe("top-right");
		expect(nearestCorner({ x: 100, y: 500 }, area)).toBe("bottom-left");
		expect(nearestCorner({ x: 501, y: 301 }, area)).toBe("bottom-right");
	});

	it("arrastando, não sai pelas bordas", () => {
		expect(clampToArea({ left: -50, top: -10 }, area)).toEqual({
			left: 0,
			top: 0,
		});
		expect(clampToArea({ left: 2000, top: 2000 }, area)).toEqual({
			left: 680,
			top: 420,
		});
		// Numa área menor que a miniatura, fica no zero.
		expect(
			clampToArea({ left: 30, top: 30 }, { width: 200, height: 100 }),
		).toEqual({
			left: 0,
			top: 0,
		});
	});

	it("o canto fica gravado, e um valor estranho no disco volta para o padrão", async () => {
		setMiniCorner("top-left");
		expect(
			JSON.parse(localStorage.getItem("ashtar-mini-share") ?? "{}").state,
		).toEqual({
			corner: "top-left",
		});

		localStorage.setItem(
			"ashtar-mini-share",
			JSON.stringify({ state: { corner: "meio" }, version: 1 }),
		);
		await useMiniShare.persist.rehydrate();
		expect(useMiniShare.getState().corner).toBe("bottom-right");
	});
});
