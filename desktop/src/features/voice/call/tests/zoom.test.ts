import { describe, expect, it } from "vitest";
import {
	clampZoom,
	isZoomed,
	MAX_ZOOM,
	NO_ZOOM,
	panBy,
	wheelFactor,
	zoomAt,
	zoomLabel,
	zoomTransform,
} from "../model/zoom";

const size = { width: 800, height: 450 };

describe("zoom", () => {
	it("prende a escala entre 1× e 4×", () => {
		expect(zoomAt(NO_ZOOM, 0.5, { x: 0, y: 0 }, size)).toEqual(NO_ZOOM);
		expect(zoomAt(NO_ZOOM, 10, { x: 0, y: 0 }, size).scale).toBe(MAX_ZOOM);
	});

	it("mantém parado o ponto sob o mouse", () => {
		const point = { x: 200, y: -100 };
		const zoom = zoomAt(NO_ZOOM, 2, point, size);
		expect(zoom.scale).toBe(2);
		// O ponto do vídeo que estava sob o mouse: (point - t) / s, antes e depois.
		expect((point.x - zoom.x) / zoom.scale).toBeCloseTo(point.x);
		expect((point.y - zoom.y) / zoom.scale).toBeCloseTo(point.y);
	});

	it("não deixa borda vazia ao arrastar", () => {
		const zoom = { scale: 2, x: 0, y: 0 };
		expect(panBy(zoom, 10_000, -10_000, size)).toEqual({
			scale: 2,
			x: 400,
			y: -225,
		});
	});

	it("sem ampliar, não arrasta", () => {
		expect(panBy(NO_ZOOM, 50, 50, size)).toEqual(NO_ZOOM);
	});

	it("reduzir puxa a imagem de volta para dentro", () => {
		const zoom = { scale: 4, x: 1200, y: 675 };
		const out = zoomAt(zoom, 0.5, { x: 0, y: 0 }, size);
		expect(out.scale).toBe(2);
		expect(out.x).toBeLessThanOrEqual(400);
		expect(out.y).toBeLessThanOrEqual(225);
	});

	it("prende de novo quando o bloco diminui", () => {
		expect(clampZoom({ scale: 2, x: 400, y: 0 }, { width: 400, height: 225 })).toEqual({
			scale: 2,
			x: 200,
			y: 0,
		});
	});

	it("a roda para cima amplia e para baixo reduz", () => {
		expect(wheelFactor(-100)).toBeGreaterThan(1);
		expect(wheelFactor(100)).toBeLessThan(1);
	});

	it("o texto e o transform", () => {
		expect(zoomLabel({ scale: 2.54, x: 0, y: 0 })).toBe("2,5×");
		expect(zoomLabel({ scale: 3, x: 0, y: 0 })).toBe("3×");
		expect(isZoomed(NO_ZOOM)).toBe(false);
		expect(zoomTransform(NO_ZOOM)).toBeUndefined();
		expect(zoomTransform({ scale: 2, x: 10, y: -5 })).toBe(
			"translate(10px, -5px) scale(2)",
		);
	});
});
