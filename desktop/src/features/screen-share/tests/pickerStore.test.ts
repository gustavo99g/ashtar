import { describe, expect, it } from "vitest";
import type { CaptureSource } from "@/lib/tauri/commands";
import { fakeShareController } from "@/test/fakeShareController";
import type { ShareRequest } from "../model/controller";
import { restartShare, startShare } from "../stores/pickerStore";

const source: CaptureSource = {
	source: { kind: "window", id: 1 },
	title: "Navegador",
	processId: 7,
	icon: null,
	monitor: null,
	minimized: false,
};
const request: ShareRequest = {
	source,
	quality: "1080p30",
	audio: { mode: "application", processId: 7 },
	cursor: true,
};

describe("restartShare", () => {
	it("religa o mesmo áudio, sem parar o vídeo", async () => {
		const controller = fakeShareController({
			status: "active",
			sessionId: 1,
			source,
			quality: "1080p30",
			audioMode: request.audio,
			cursor: true,
			paused: false,
			audio: "lost",
		});
		await startShare(controller, request);

		await restartShare(controller);

		expect(controller.update).toHaveBeenCalledWith({
			kind: "audio",
			audio: request.audio,
		});
		expect(controller.stop).not.toHaveBeenCalled();
	});

	it("não faz nada sem transmissão ativa", async () => {
		const controller = fakeShareController({ status: "idle" });
		await startShare(controller, request);

		await restartShare(controller);

		expect(controller.update).not.toHaveBeenCalled();
	});
});
