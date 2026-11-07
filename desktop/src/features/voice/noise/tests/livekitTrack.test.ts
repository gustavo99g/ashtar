import { LocalAudioTrack } from "livekit-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BROWSER_CONSTRAINTS,
	createRnnoiseProcessor,
	type NoiseAudio,
} from "../rnnoise";

/**
 * Uma MediaStreamTrack de mentira, com o que o `LocalAudioTrack` do LiveKit toca nela. Como num
 * navegador, `getConstraints()` devolve o que foi pedido ao `getUserMedia`: é dele que o LiveKit
 * tira as restrições que reaplica ao tirar o processador.
 */
function fakeMediaTrack(
	label: string,
	constraints: MediaTrackConstraints = { deviceId: "mic-usb" },
) {
	return {
		kind: "audio",
		label,
		enabled: true,
		readyState: "live",
		getSettings: () => ({ deviceId: "mic-usb" }),
		getConstraints: () => constraints,
		applyConstraints: vi.fn(async () => {}),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		stop: vi.fn(),
	} as unknown as MediaStreamTrack;
}

function fakeAudio(processed: MediaStreamTrack): NoiseAudio {
	const node = { connect: vi.fn((next) => next), disconnect: vi.fn() };
	const context = {
		state: "running",
		createMediaStreamSource: () => ({
			connect: () => node,
			disconnect: vi.fn(),
		}),
		createMediaStreamDestination: () => ({
			stream: { getAudioTracks: () => [processed] },
		}),
		close: vi.fn(async () => {}),
	};
	return {
		createContext: () => context as unknown as AudioContext,
		loadWasm: async () => new ArrayBuffer(8),
		addWorklet: async () => {},
		createNode: async () => node as unknown as AudioWorkletNode,
	};
}

beforeEach(() => {
	vi.stubGlobal(
		"MediaStream",
		class {
			constructor(public tracks: MediaStreamTrack[]) {}
		},
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// O contrato do LiveKit que a supressão de ruído respeita: o processador só entra numa trilha que já
// tem o `AudioContext`, e a trilha recém-criada (`createLocalTracks`) não tem. Por isso o RNNoise
// entra depois de o microfone ser publicado, e não pelas opções da sala.
describe("o RNNoise na trilha de verdade do LiveKit", () => {
	it("a trilha sem AudioContext recusa o processador", async () => {
		const track = new LocalAudioTrack(fakeMediaTrack("mic"), undefined, false);
		const processor = createRnnoiseProcessor(fakeAudio(fakeMediaTrack("saida")));

		await expect(track.setProcessor(processor)).rejects.toThrow(
			"Audio context needs to be set on LocalAudioTrack",
		);
	});

	it("com o AudioContext (depois de publicada), aceita, e a trilha passa a ser a que sai do RNNoise", async () => {
		// O microfone como o `createLocalTracks` o cria: com as restrições padrão do LiveKit.
		const created = { deviceId: "mic-usb", ...BROWSER_CONSTRAINTS };
		const raw = fakeMediaTrack("mic", created);
		const out = fakeMediaTrack("saida");
		const track = new LocalAudioTrack(raw, created, false);
		track.setAudioContext({} as AudioContext);
		const processor = createRnnoiseProcessor(fakeAudio(out));

		await track.setProcessor(processor);

		expect(track.getProcessor()).toBe(processor);
		expect(track.mediaStreamTrack).toBe(out);

		await track.stopProcessor();
		expect(track.getProcessor()).toBeUndefined();
		// O LiveKit reaplica as restrições com que criou o microfone: a supressão do navegador volta.
		expect(raw.applyConstraints).toHaveBeenLastCalledWith(created);
	});
});
