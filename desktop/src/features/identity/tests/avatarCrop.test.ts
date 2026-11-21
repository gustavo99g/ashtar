import { describe, expect, it } from "vitest";
import { clampCrop, cropSource } from "../model/avatarCrop";

describe("o recorte da foto", () => {
	it("sem zoom, pega o quadrado do meio do lado menor", () => {
		expect(cropSource(400, 200, 200, { zoom: 1, x: 0, y: 0 })).toEqual({
			sx: 100,
			sy: 0,
			size: 200,
		});
	});

	it("com zoom 2, pega a metade, e arrastar para a direita mostra o lado esquerdo", () => {
		expect(cropSource(200, 200, 200, { zoom: 2, x: 50, y: 0 })).toEqual({
			sx: 25,
			sy: 50,
			size: 100,
		});
	});

	it("a imagem nunca deixa um canto do quadro vazio", () => {
		expect(clampCrop(400, 200, 200, { zoom: 5, x: 9999, y: -9999 })).toEqual({
			zoom: 3,
			x: 500,
			y: -200,
		});
		expect(clampCrop(400, 200, 200, { zoom: 0.5, x: 0, y: 30 })).toEqual({
			zoom: 1,
			x: 0,
			y: 0,
		});
	});
});
