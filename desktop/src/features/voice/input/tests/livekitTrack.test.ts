import { LocalAudioTrack } from "livekit-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureConstraints, createInputProcessor } from "../chain";
import { DEFAULT_INPUT } from "../stores/inputStore";
import { fakeAudio } from "./fakeAudio";

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

// O contrato do LiveKit que a cadeia do microfone respeita: o processador só entra numa trilha que já
// tem o `AudioContext`, e a trilha recém-criada (`createLocalTracks`) não tem. Por isso o RNNoise
// entra depois de o microfone ser publicado, e não pelas opções da sala.
describe("a cadeia na trilha de verdade do LiveKit", () => {
	it("a trilha sem AudioContext recusa o processador", async () => {
		const track = new LocalAudioTrack(fakeMediaTrack("mic"), undefined, false);
		const processor = createInputProcessor(
			DEFAULT_INPUT,
			fakeAudio(fakeMediaTrack("saida")).audio,
		);

		await expect(track.setProcessor(processor)).rejects.toThrow(
			"Audio context needs to be set on LocalAudioTrack",
		);
	});

	it("com o AudioContext (depois de publicada), aceita, e a trilha passa a ser a que sai da cadeia", async () => {
		// O microfone como o `createLocalTracks` o cria: com as restrições padrão do LiveKit.
		const created = { deviceId: "mic-usb", ...captureConstraints(DEFAULT_INPUT, false) };
		const raw = fakeMediaTrack("mic", created);
		const out = fakeMediaTrack("saida");
		const track = new LocalAudioTrack(raw, created, false);
		track.setAudioContext({} as AudioContext);
		const processor = createInputProcessor(DEFAULT_INPUT, fakeAudio(out).audio);

		await track.setProcessor(processor);

		expect(track.getProcessor()).toBe(processor);
		expect(track.mediaStreamTrack).toBe(out);

		await track.stopProcessor();
		expect(track.getProcessor()).toBeUndefined();
		// O LiveKit reaplica as restrições com que criou o microfone: a supressão do navegador volta.
		expect(raw.applyConstraints).toHaveBeenLastCalledWith(created);
	});
});
