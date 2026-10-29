import type { Room } from "livekit-client";
import { describe, expect, it, vi } from "vitest";
import { roomOptions, switchDevice } from "../roomDevices";

/** Só o que o `switchDevice` usa da sala. */
function fakeRoom(
	active: string,
	switchActiveDevice = vi.fn(async () => true),
) {
	return {
		room: {
			getActiveDevice: () => active,
			switchActiveDevice,
		} as unknown as Room,
		switchActiveDevice,
	};
}

describe("dispositivos na sala", () => {
	it("as opções da sala levam só o que foi escolhido", () => {
		expect(roomOptions({ input: null, output: null })).toEqual({});
		expect(roomOptions({ input: "mic-usb", output: null })).toEqual({
			audioCaptureDefaults: { deviceId: { ideal: "mic-usb" } },
		});
		expect(roomOptions({ input: null, output: "fone-bt" })).toEqual({
			audioOutput: { deviceId: "fone-bt" },
		});
	});

	it("não troca o que já está valendo", async () => {
		const { room, switchActiveDevice } = fakeRoom("default");

		await switchDevice(room, "output", null);

		expect(switchActiveDevice).not.toHaveBeenCalled();
	});

	it("o padrão do Windows é o default do LiveKit", async () => {
		const { room, switchActiveDevice } = fakeRoom("mic-usb");

		await switchDevice(room, "input", null);

		expect(switchActiveDevice).toHaveBeenCalledWith("audioinput", "default");
	});

	it("uma troca que falha fica no log, e a chamada segue", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { room } = fakeRoom(
			"default",
			vi.fn(async () => {
				throw new Error("NotFoundError");
			}),
		);

		await expect(
			switchDevice(room, "output", "fone-bt"),
		).resolves.toBeUndefined();
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});
