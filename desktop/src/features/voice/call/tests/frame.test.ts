import { afterEach, describe, expect, it, vi } from "vitest";
import { captureFrame } from "../model/frame";

function video(width: number, height: number): HTMLVideoElement {
	const element = document.createElement("video");
	Object.defineProperty(element, "videoWidth", { value: width });
	Object.defineProperty(element, "videoHeight", { value: height });
	return element;
}

afterEach(() => vi.restoreAllMocks());

describe("captureFrame", () => {
	it("antes do primeiro quadro, nada", async () => {
		expect(await captureFrame(video(0, 0))).toBeNull();
	});

	it("desenha no tamanho que chega e devolve um PNG", async () => {
		const drawImage = vi.fn();
		const png = new Blob(["png"], { type: "image/png" });
		const canvas = document.createElement("canvas");
		vi.spyOn(canvas, "getContext").mockReturnValue({
			drawImage,
		} as unknown as CanvasRenderingContext2D);
		const toBlob = vi
			.spyOn(canvas, "toBlob")
			.mockImplementation((callback) => callback(png));
		const create = document.createElement.bind(document);
		vi.spyOn(document, "createElement").mockImplementation((tag: string) =>
			tag === "canvas" ? canvas : create(tag),
		);

		const source = video(1920, 1080);
		expect(await captureFrame(source)).toBe(png);
		expect(canvas.width).toBe(1920);
		expect(canvas.height).toBe(1080);
		expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 1920, 1080);
		expect(toBlob.mock.calls[0][1]).toBe("image/png");
	});
});
