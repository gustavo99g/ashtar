import { VideoPresets } from "livekit-client";
import { describe, expect, it } from "vitest";
import {
	cameraCapture,
	cameraPublish,
	effectiveCamera,
	isCameraQuality,
	readCameras,
} from "../model/camera";

describe("readCameras", () => {
	it("só as câmeras, sem as entradas vazias", () => {
		expect(
			readCameras([
				{ kind: "audioinput", deviceId: "mic", label: "Mic", groupId: "" },
				{ kind: "videoinput", deviceId: "", label: "", groupId: "" },
				{ kind: "videoinput", deviceId: "cam", label: "Webcam C920", groupId: "" },
			]),
		).toEqual([{ id: "cam", label: "Webcam C920" }]);
	});
});

describe("effectiveCamera", () => {
	const cameras = [{ id: "cam", label: "Webcam" }];

	it("nada escolhido é a padrão", () => {
		expect(effectiveCamera(null, cameras)).toBeNull();
	});

	it("a escolhida, se está ligada; sem ela, a padrão", () => {
		expect(effectiveCamera({ id: "cam", label: "Webcam" }, cameras)).toBe("cam");
		expect(effectiveCamera({ id: "old", label: "Velha" }, cameras)).toBeNull();
	});

	it("antes de ler a lista, vale a escolhida", () => {
		expect(effectiveCamera({ id: "old", label: "Velha" }, null)).toBe("old");
	});
});

describe("opções da câmera", () => {
	it("abre no tamanho da qualidade, a 30 fps", () => {
		expect(cameraCapture("cam", "1080p")).toEqual({
			deviceId: { exact: "cam" },
			resolution: { width: 1920, height: 1080, frameRate: 30 },
		});
		expect(cameraCapture(null, "480p")).toEqual({
			resolution: { width: 854, height: 480, frameRate: 30 },
		});
	});

	it("publica com camadas", () => {
		expect(cameraPublish("720p")).toMatchObject({
			simulcast: true,
			videoEncoding: { maxBitrate: 1_700_000, maxFramerate: 30 },
			videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
		});
		expect(cameraPublish("480p").videoSimulcastLayers).toEqual([VideoPresets.h180]);
	});

	it("reconhece as qualidades", () => {
		expect(isCameraQuality("720p")).toBe(true);
		expect(isCameraQuality("4k")).toBe(false);
	});
});
