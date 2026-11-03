import { describe, expect, it, vi } from "vitest";
import type { CaptureSource } from "@/lib/tauri/commands";
import type {
	ScreenShareController,
	ScreenShareState,
	ShareRequest,
} from "../model/controller";
import { restartShare, startShare } from "../stores/pickerStore";

const source: CaptureSource = {
	source: { kind: "window", id: 1 },
	title: "Navegador",
	processId: 7,
	icon: null,
	monitor: null,
};
const request: ShareRequest = {
	source,
	quality: "900p60",
	audio: { mode: "application", processId: 7 },
};

function fakeController(state: ScreenShareState) {
	return {
		getState: () => state,
		onStateChange: () => () => {},
		listSources: async () => [],
		start: vi.fn(async () => {}),
		stop: vi.fn(async () => {}),
		dispose: async () => {},
	} satisfies ScreenShareController;
}

describe("restartShare", () => {
	it("para e começa de novo com o último pedido", async () => {
		const controller = fakeController({
			status: "active",
			sessionId: 1,
			source,
			audio: "lost",
		});
		await startShare(controller, request);
		controller.start.mockClear();

		await restartShare(controller);

		expect(controller.stop).toHaveBeenCalledOnce();
		expect(controller.start).toHaveBeenCalledWith(request);
	});

	it("não faz nada sem transmissão ativa", async () => {
		const controller = fakeController({ status: "idle" });
		await startShare(controller, request);

		await restartShare(controller);

		expect(controller.stop).not.toHaveBeenCalled();
	});
});
