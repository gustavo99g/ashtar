import { beforeEach, describe, expect, it } from "vitest";
import {
	clampToArea,
	miniSide,
	nearestCorner,
	slotPosition,
} from "../model/miniCorner";
import { setMiniCorner, useMiniShare } from "../stores/miniShareStore";

const area = { width: 1000, height: 600 };

describe("o canto da miniatura", () => {
	beforeEach(() => {
		localStorage.clear();
		useMiniShare.setState({ corner: "bottom-right", collapsed: false });
	});

	it("solta, vai para o encaixe da metade e do terço em que o centro caiu", () => {
		expect(nearestCorner({ x: 100, y: 100 }, area)).toBe("top-left");
		expect(nearestCorner({ x: 900, y: 100 }, area)).toBe("top-right");
		expect(nearestCorner({ x: 100, y: 300 }, area)).toBe("left");
		expect(nearestCorner({ x: 501, y: 301 }, area)).toBe("right");
		expect(nearestCorner({ x: 100, y: 500 }, area)).toBe("bottom-left");
		expect(nearestCorner({ x: 900, y: 401 }, area)).toBe("bottom-right");
	});

	it("cada encaixe tem o seu lugar, a 16 px das bordas", () => {
		expect(slotPosition("top-left", area)).toEqual({ left: 16, top: 16 });
		expect(slotPosition("right", area)).toEqual({ left: 664, top: 210 });
		expect(slotPosition("bottom-left", area)).toEqual({ left: 16, top: 404 });
		expect(miniSide("left")).toBe("left");
		expect(miniSide("bottom-right")).toBe("right");
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
			collapsed: false,
		});

		localStorage.setItem(
			"ashtar-mini-share",
			JSON.stringify({
				state: { corner: "meio", collapsed: "sim" },
				version: 1,
			}),
		);
		await useMiniShare.persist.rehydrate();
		expect(useMiniShare.getState()).toMatchObject({
			corner: "bottom-right",
			collapsed: false,
		});
	});
});
