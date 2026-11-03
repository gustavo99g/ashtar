import type { LocalAudioTrack, Room } from "livekit-client";
import { Track } from "livekit-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BROWSER_CONSTRAINTS,
	createRnnoiseProcessor,
	MIC_CONSTRAINTS,
	type NoiseAudio,
	RNNOISE_NAME,
	switchNoiseSuppression,
} from "../rnnoise";

// O jsdom não tem Web Audio: um grafo de mentira que anota quem liga em quem.
function fakeAudio() {
	const processed = { stop: vi.fn() } as unknown as MediaStreamTrack;
	const node = { connect: vi.fn(), disconnect: vi.fn(), destroy: vi.fn() };
	const source = {
		connect: vi.fn(() => node),
		disconnect: vi.fn(),
	};
	node.connect.mockImplementation((next) => next);
	const context = {
		state: "running" as AudioContextState,
		createMediaStreamSource: vi.fn(() => source),
		createMediaStreamDestination: vi.fn(() => ({
			stream: { getAudioTracks: () => [processed] },
		})),
		resume: vi.fn(async () => {}),
		close: vi.fn(async () => {
			context.state = "closed";
		}),
	};
	const audio: NoiseAudio = {
		createContext: vi.fn(() => context as unknown as AudioContext),
		loadWasm: vi.fn(async () => new ArrayBuffer(8)),
		addWorklet: vi.fn(async () => {}),
		createNode: vi.fn(async () => node as unknown as AudioWorkletNode),
	};
	return { audio, context, source, node, processed };
}

/** O microfone de verdade: só as restrições que o teste confere. */
function micTrack() {
	return {
		getConstraints: () => ({ deviceId: "mic-usb" }),
		applyConstraints: vi.fn(async () => {}),
	} as unknown as MediaStreamTrack;
}

function options(track: MediaStreamTrack) {
	return {
		kind: Track.Kind.Audio,
		track,
		audioContext: {} as AudioContext,
	} as const;
}

beforeEach(() => {
	vi.stubGlobal(
		"MediaStream",
		class {
			constructor(public tracks: MediaStreamTrack[]) {}
		},
	);
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("o processador do RNNoise", () => {
	it("passa o microfone pelo RNNoise, entrega a trilha que sai dele e só então larga a supressão do navegador", async () => {
		const fake = fakeAudio();
		const processor = createRnnoiseProcessor(fake.audio);
		const mic = micTrack();

		await processor.init(options(mic));

		expect(fake.source.connect).toHaveBeenCalledWith(fake.node);
		expect(fake.audio.createNode).toHaveBeenCalledTimes(1);
		expect(processor.processedTrack).toBe(fake.processed);
		expect(mic.applyConstraints).toHaveBeenCalledTimes(1);
		expect(mic.applyConstraints).toHaveBeenCalledWith({
			deviceId: "mic-usb",
			...MIC_CONSTRAINTS,
		});
		// Antes de o RNNoise estar pronto, o microfone segue com a supressão do navegador.
		expect(
			vi.mocked(fake.audio.createNode).mock.invocationCallOrder[0],
		).toBeLessThan(vi.mocked(mic.applyConstraints).mock.invocationCallOrder[0]);
	});

	it("trocar de microfone refaz o grafo no mesmo contexto e vale para a trilha nova", async () => {
		const fake = fakeAudio();
		const processor = createRnnoiseProcessor(fake.audio);
		await processor.init(options(micTrack()));
		const next = micTrack();

		await processor.restart(options(next));

		expect(fake.source.disconnect).toHaveBeenCalled();
		expect(fake.node.destroy).toHaveBeenCalled();
		expect(fake.audio.createContext).toHaveBeenCalledTimes(1);
		expect(fake.audio.addWorklet).toHaveBeenCalledTimes(1);
		expect(fake.audio.createNode).toHaveBeenCalledTimes(2);
		expect(next.applyConstraints).toHaveBeenCalledWith({
			deviceId: "mic-usb",
			...MIC_CONSTRAINTS,
		});
	});

	it("sair fecha o contexto e devolve ao microfone a supressão do navegador", async () => {
		const fake = fakeAudio();
		const processor = createRnnoiseProcessor(fake.audio);
		const mic = micTrack();
		await processor.init(options(mic));

		await processor.destroy();

		expect(fake.context.close).toHaveBeenCalled();
		expect(processor.processedTrack).toBeUndefined();
		expect(mic.applyConstraints).toHaveBeenLastCalledWith({
			deviceId: "mic-usb",
			...BROWSER_CONSTRAINTS,
		});
		// A próxima trilha abre outro contexto.
		await processor.init(options(micTrack()));
		expect(fake.audio.createContext).toHaveBeenCalledTimes(2);
	});

	it("se o RNNoise não carrega, a trilha segue com a supressão do navegador", async () => {
		const fake = fakeAudio();
		vi.mocked(fake.audio.loadWasm).mockRejectedValue(new Error("wasm"));
		const processor = createRnnoiseProcessor(fake.audio);
		const mic = micTrack();

		await expect(processor.init(options(mic))).resolves.toBeUndefined();

		expect(processor.processedTrack).toBeUndefined();
		expect(mic.applyConstraints).toHaveBeenCalledTimes(1);
		expect(mic.applyConstraints).toHaveBeenCalledWith({
			deviceId: "mic-usb",
			...BROWSER_CONSTRAINTS,
		});
	});

	it("uma trilha que já terminou não faz o destroy falhar", async () => {
		const fake = fakeAudio();
		const processor = createRnnoiseProcessor(fake.audio);
		const mic = micTrack();
		await processor.init(options(mic));
		vi.mocked(mic.applyConstraints).mockRejectedValue(new Error("ended"));

		await expect(processor.destroy()).resolves.toBeUndefined();
	});
});

type Processor = ReturnType<typeof createRnnoiseProcessor>;

/**
 * Uma sala com o microfone publicado, com o LiveKit de verdade no que importa: `setProcessor`
 * entrega ao `init` o microfone original, e `stopProcessor` chama o `destroy` do processador. O
 * `stopGate` segura o `stopProcessor`, para o teste emendar outra troca no meio.
 */
function callRoom({ stopGate = Promise.resolve(), published = true } = {}) {
	const mic = micTrack();
	let current: Processor | undefined;
	const track = {
		getProcessor: vi.fn(() => current),
		setProcessor: vi.fn(async (next: Processor) => {
			await next.init(options(mic));
			current = next;
		}),
		stopProcessor: vi.fn(async () => {
			await stopGate;
			await current?.destroy();
			current = undefined;
		}),
	};
	const room = {
		localParticipant: {
			getTrackPublication: () => (published ? { track } : undefined),
		},
	} as unknown as Room;
	return { room, track: track as unknown as LocalAudioTrack & typeof track, mic };
}

describe("ligar e desligar a supressão", () => {
	it("ligar põe o RNNoise na trilha; repetir não faz nada", async () => {
		const processor = createRnnoiseProcessor(fakeAudio().audio);
		const { room, track, mic } = callRoom();

		await switchNoiseSuppression(room, true, () => processor);
		expect(track.setProcessor).toHaveBeenCalledWith(processor);
		expect(mic.applyConstraints).toHaveBeenLastCalledWith({
			deviceId: "mic-usb",
			...MIC_CONSTRAINTS,
		});

		await switchNoiseSuppression(room, true);
		expect(track.setProcessor).toHaveBeenCalledTimes(1);
	});

	it("desligar tira o RNNoise e o microfone volta à supressão do navegador", async () => {
		const { room, track, mic } = callRoom();
		await switchNoiseSuppression(room, true, () =>
			createRnnoiseProcessor(fakeAudio().audio),
		);

		await switchNoiseSuppression(room, false);

		expect(track.stopProcessor).toHaveBeenCalledTimes(1);
		expect(track.getProcessor()).toBeUndefined();
		expect(mic.applyConstraints).toHaveBeenLastCalledWith({
			deviceId: "mic-usb",
			...BROWSER_CONSTRAINTS,
		});

		await switchNoiseSuppression(room, false);
		expect(track.stopProcessor).toHaveBeenCalledTimes(1);
	});

	it("sem o microfone publicado, não faz nada", async () => {
		const { room, track } = callRoom({ published: false });
		await expect(switchNoiseSuppression(room, true)).resolves.toBeUndefined();
		expect(track.setProcessor).not.toHaveBeenCalled();
	});

	it("se o LiveKit recusa o processador, fica no log e o microfone não muda", async () => {
		const { room, track, mic } = callRoom();
		track.setProcessor.mockRejectedValue(
			new Error(
				"Audio context needs to be set on LocalAudioTrack in order to enable processors",
			),
		);

		await expect(switchNoiseSuppression(room, true)).resolves.toBeUndefined();

		expect(console.warn).toHaveBeenCalled();
		expect(mic.applyConstraints).not.toHaveBeenCalled();
	});

	it("desligar e ligar depressa termina ligado: as trocas andam em fila", async () => {
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { room, track } = callRoom({ stopGate: gate });
		await switchNoiseSuppression(room, true, () =>
			createRnnoiseProcessor(fakeAudio().audio),
		);
		const second = createRnnoiseProcessor(fakeAudio().audio);

		const off = switchNoiseSuppression(room, false);
		const on = switchNoiseSuppression(room, true, () => second);
		release();
		await Promise.all([off, on]);

		// Sem a fila, o segundo pedido veria o RNNoise ainda ativo e sairia sem fazer nada.
		expect(track.getProcessor()).toBe(second);
		expect(track.getProcessor()?.name).toBe(RNNOISE_NAME);
	});
});
