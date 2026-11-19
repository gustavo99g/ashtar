import { beforeEach, describe, expect, it } from "vitest";
import {
	chooseCamera,
	chooseCameraQuality,
	setCameraMirror,
	useCameraChoice,
} from "../stores/cameraChoiceStore";

beforeEach(() => {
	useCameraChoice.setState({ device: null, quality: "720p", mirror: true });
});

describe("cameraChoiceStore", () => {
	it("começa na padrão, em 720p e espelhada", () => {
		expect(useCameraChoice.getState()).toMatchObject({
			device: null,
			quality: "720p",
			mirror: true,
		});
	});

	it("guarda a câmera, a qualidade e o espelhar", () => {
		chooseCamera({ id: "cam", label: "Webcam" });
		chooseCameraQuality("1080p");
		setCameraMirror(false);
		expect(useCameraChoice.getState()).toMatchObject({
			device: { id: "cam", label: "Webcam" },
			quality: "1080p",
			mirror: false,
		});
		chooseCamera(null);
		expect(useCameraChoice.getState().device).toBeNull();
	});

	it("um valor estranho no disco volta para o padrão", async () => {
		localStorage.setItem(
			"ashtar-camera",
			JSON.stringify({ state: { device: { id: 3 }, quality: "4k", mirror: "x" }, version: 1 }),
		);
		await useCameraChoice.persist.rehydrate();
		expect(useCameraChoice.getState()).toMatchObject({
			device: null,
			quality: "720p",
			mirror: true,
		});
	});
});
