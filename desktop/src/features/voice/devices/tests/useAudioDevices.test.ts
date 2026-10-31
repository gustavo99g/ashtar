import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceInfo } from "../model/devices";
import { useAudioDevices } from "../hooks/useAudioDevices";

const MIC: DeviceInfo = {
	kind: "audioinput",
	deviceId: "mic-usb",
	label: "Microfone (Headset USB)",
	groupId: "g-usb",
};
const HEADSET: DeviceInfo = {
	kind: "audiooutput",
	deviceId: "out-bt",
	label: "Fones de ouvido (Fone Bluetooth)",
	groupId: "g-bt",
};
const HIDDEN: DeviceInfo = {
	kind: "audioinput",
	deviceId: "",
	label: "",
	groupId: "",
};

/** Um `navigator.mediaDevices` de mentira: a lista muda e o `devicechange` dispara à mão. */
function fakeMediaDevices(initial: DeviceInfo[]) {
	let list = initial;
	const target = new EventTarget();
	const stop = vi.fn();
	const media = Object.assign(target, {
		enumerateDevices: vi.fn(async () => list),
		getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })),
	});
	Object.defineProperty(navigator, "mediaDevices", {
		value: media,
		configurable: true,
	});
	return {
		media,
		stop,
		/** Troca a lista, como o Windows ao ligar ou desligar um fone, e avisa. */
		change(next: DeviceInfo[]) {
			list = next;
			act(() => {
				target.dispatchEvent(new Event("devicechange"));
			});
		},
	};
}

afterEach(() => {
	Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("useAudioDevices", () => {
	it("lê a lista e lê de novo quando um fone liga e desliga", async () => {
		const fake = fakeMediaDevices([MIC]);
		const { result } = renderHook(() => useAudioDevices());

		await waitFor(() => expect(result.current?.input).toHaveLength(1));
		expect(result.current?.output).toEqual([]);

		fake.change([MIC, HEADSET]);
		await waitFor(() =>
			expect(result.current?.output.map((device) => device.id)).toEqual([
				"out-bt",
			]),
		);

		fake.change([MIC]);
		await waitFor(() => expect(result.current?.output).toEqual([]));
	});

	it("para de ouvir o devicechange ao desmontar", async () => {
		const fake = fakeMediaDevices([MIC]);
		const { unmount } = renderHook(() => useAudioDevices());
		await waitFor(() => expect(fake.media.enumerateDevices).toHaveBeenCalled());

		unmount();
		fake.change([MIC, HEADSET]);

		expect(fake.media.enumerateDevices).toHaveBeenCalledTimes(1);
	});

	it("com revealNames, abre o microfone um instante quando os nomes vêm escondidos", async () => {
		const fake = fakeMediaDevices([HIDDEN]);
		fake.media.getUserMedia.mockImplementationOnce(async () => {
			// Com a permissão, o WebView2 passa a dizer os nomes.
			fake.media.enumerateDevices.mockResolvedValue([MIC]);
			return { getTracks: () => [{ stop: fake.stop }] };
		});
		const { result } = renderHook(() => useAudioDevices({ revealNames: true }));

		await waitFor(() => expect(result.current?.hidden).toBe(false));
		expect(result.current?.input.map((device) => device.label)).toEqual([
			"Microfone (Headset USB)",
		]);
		expect(fake.media.getUserMedia).toHaveBeenCalledWith({ audio: true });
		expect(fake.stop).toHaveBeenCalled();
	});

	it("sem revealNames, não abre o microfone", async () => {
		const fake = fakeMediaDevices([HIDDEN]);
		const { result } = renderHook(() => useAudioDevices());

		await waitFor(() => expect(result.current?.hidden).toBe(true));
		expect(fake.media.getUserMedia).not.toHaveBeenCalled();
	});

	it("sem o mediaDevices, a lista não diz nada", () => {
		const { result } = renderHook(() => useAudioDevices());

		expect(result.current).toMatchObject({ input: [], hidden: true });
	});
});
