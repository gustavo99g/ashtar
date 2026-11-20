import type { LocalAudioTrack, Room } from "livekit-client";
import { Track } from "livekit-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyInputChain,
	buildInputGraph,
	captureConstraints,
	type ChainOptions,
	createInputProcessor,
	INPUT_PROCESSOR,
	type InputProcessor,
	isPushToTalkHeld,
	setPushToTalkHeld,
} from "../chain";
import { DEFAULT_INPUT } from "../stores/inputStore";
import { fakeAudio, micTrack } from "./fakeAudio";

const OPTIONS: ChainOptions = {
	suppression: true,
	echoCancellation: true,
	autoGainControl: true,
	volume: 100,
	mode: "voice",
	autoSensitivity: true,
	thresholdDb: -50,
};

const WITH_RNNOISE = { deviceId: "mic-usb", ...captureConstraints(OPTIONS, true) };
const WITHOUT_RNNOISE = { deviceId: "mic-usb", ...captureConstraints(OPTIONS, false) };

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
	setPushToTalkHeld(false);
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("as restrições da captura", () => {
	it("com o RNNoise, desliga a supressão do navegador; sem ele, liga", () => {
		expect(captureConstraints(OPTIONS, true).noiseSuppression).toBe(false);
		expect(captureConstraints(OPTIONS, false).noiseSuppression).toBe(true);
	});

	it("o eco e o ganho automático seguem a escolha", () => {
		expect(
			captureConstraints(
				{ echoCancellation: false, autoGainControl: false },
				true,
			),
		).toEqual({
			noiseSuppression: false,
			echoCancellation: false,
			autoGainControl: false,
		});
	});
});

describe("o grafo do microfone", () => {
	it("liga volume → RNNoise → portão → saída e manda ao portão a sensibilidade", async () => {
		const fake = fakeAudio();
		const graph = await buildInputGraph(
			micTrack(),
			{ ...OPTIONS, volume: 150 },
			vi.fn(),
			fake.audio,
		);

		expect(fake.source.connect).toHaveBeenCalledWith(fake.gain);
		expect(fake.gain.connect).toHaveBeenCalledWith(fake.rnnoise);
		expect(fake.rnnoise.connect).toHaveBeenCalledWith(fake.gate);
		expect(fake.gain.gain.value).toBe(1.5);
		expect(fake.lastParams()).toEqual({
			mode: "voice",
			auto: true,
			thresholdDb: -50,
			held: false,
		});
		expect(graph.rnnoise).toBe(true);
		expect(graph.output).toBe(fake.processed);
	});

	it("sem a supressão, o RNNoise nem carrega", async () => {
		const fake = fakeAudio();
		const graph = await buildInputGraph(
			micTrack(),
			{ ...OPTIONS, suppression: false },
			vi.fn(),
			fake.audio,
		);

		expect(fake.audio.loadWasm).not.toHaveBeenCalled();
		expect(fake.gain.connect).toHaveBeenCalledWith(fake.gate);
		expect(graph.rnnoise).toBe(false);
	});

	it("se o RNNoise falha, segue só com o volume e o portão", async () => {
		const fake = fakeAudio();
		fake.audio.loadWasm.mockRejectedValue(new Error("wasm"));

		const graph = await buildInputGraph(micTrack(), OPTIONS, vi.fn(), fake.audio);

		expect(graph.rnnoise).toBe(false);
		expect(fake.gain.connect).toHaveBeenCalledWith(fake.gate);
		expect(console.warn).toHaveBeenCalled();
	});

	it("se o portão não carrega, fecha o contexto e lança", async () => {
		const fake = fakeAudio();
		fake.audio.addGateWorklet.mockRejectedValue(new Error("worklet"));

		await expect(
			buildInputGraph(micTrack(), OPTIONS, vi.fn(), fake.audio),
		).rejects.toThrow("worklet");
		expect(fake.context.close).toHaveBeenCalled();
	});

	it("o volume e a sensibilidade mudam no grafo de agora", async () => {
		const fake = fakeAudio();
		const graph = await buildInputGraph(micTrack(), OPTIONS, vi.fn(), fake.audio);

		graph.update({ ...OPTIONS, volume: 50, autoSensitivity: false, thresholdDb: -30 });

		expect(fake.gain.gain.value).toBe(0.5);
		expect(fake.lastParams()).toMatchObject({ auto: false, thresholdDb: -30 });
		expect(fake.audio.createContext).toHaveBeenCalledTimes(1);
	});

	it("passa adiante o nível que o portão mede", async () => {
		const fake = fakeAudio();
		const onLevel = vi.fn();
		await buildInputGraph(micTrack(), OPTIONS, onLevel, fake.audio);

		fake.level({ level: -20, open: true, threshold: -50 });

		expect(onLevel).toHaveBeenCalledWith({ level: -20, open: true, threshold: -50 });
	});

	it("fechar desliga os nós, para a saída e fecha o contexto", async () => {
		const fake = fakeAudio();
		const graph = await buildInputGraph(micTrack(), OPTIONS, vi.fn(), fake.audio);

		await graph.close();

		expect(fake.rnnoise.destroy).toHaveBeenCalled();
		expect(fake.gate.disconnect).toHaveBeenCalled();
		expect(fake.processed.stop).toHaveBeenCalled();
		expect(fake.context.close).toHaveBeenCalled();
	});
});

describe("o processador da trilha", () => {
	it("entrega a trilha da cadeia e só então larga a supressão do navegador", async () => {
		const fake = fakeAudio();
		const processor = createInputProcessor(OPTIONS, fake.audio);
		const mic = micTrack();

		await processor.init(options(mic));

		expect(processor.processedTrack).toBe(fake.processed);
		expect(mic.applyConstraints).toHaveBeenCalledTimes(1);
		expect(mic.applyConstraints).toHaveBeenCalledWith(WITH_RNNOISE);
		expect(fake.audio.createRnnoise.mock.invocationCallOrder[0]).toBeLessThan(
			mic.applyConstraints.mock.invocationCallOrder[0],
		);
	});

	it("se o RNNoise falha, a trilha segue com a supressão do navegador", async () => {
		const fake = fakeAudio();
		fake.audio.loadWasm.mockRejectedValue(new Error("wasm"));
		const processor = createInputProcessor(OPTIONS, fake.audio);
		const mic = micTrack();

		await processor.init(options(mic));

		expect(processor.processedTrack).toBe(fake.processed);
		expect(mic.applyConstraints).toHaveBeenCalledWith(WITHOUT_RNNOISE);
	});

	it("se a cadeia inteira falha, a trilha segue sem processar", async () => {
		const fake = fakeAudio();
		fake.audio.addGateWorklet.mockRejectedValue(new Error("worklet"));
		const processor = createInputProcessor(OPTIONS, fake.audio);
		const mic = micTrack();

		await expect(processor.init(options(mic))).resolves.toBeUndefined();

		expect(processor.processedTrack).toBeUndefined();
		expect(mic.applyConstraints).toHaveBeenCalledWith(WITHOUT_RNNOISE);
	});

	it("trocar de microfone refaz o grafo com as opções de agora", async () => {
		const fake = fakeAudio();
		const processor = createInputProcessor(OPTIONS, fake.audio);
		await processor.init(options(micTrack()));
		processor.update({ ...OPTIONS, volume: 30 });
		const next = micTrack();

		await processor.restart(options(next));

		expect(fake.context.close).toHaveBeenCalledTimes(1);
		expect(fake.audio.createContext).toHaveBeenCalledTimes(2);
		expect(fake.gain.gain.value).toBeCloseTo(0.3);
		expect(next.applyConstraints).toHaveBeenCalledWith(WITH_RNNOISE);
	});

	it("sair fecha a cadeia e devolve ao microfone a supressão do navegador", async () => {
		const fake = fakeAudio();
		const processor = createInputProcessor(OPTIONS, fake.audio);
		const mic = micTrack();
		await processor.init(options(mic));

		await processor.destroy();

		expect(fake.context.close).toHaveBeenCalled();
		expect(processor.processedTrack).toBeUndefined();
		expect(mic.applyConstraints).toHaveBeenLastCalledWith(WITHOUT_RNNOISE);
	});

	it("uma trilha que já terminou não faz o destroy falhar", async () => {
		const processor = createInputProcessor(OPTIONS, fakeAudio().audio);
		const mic = micTrack();
		await processor.init(options(mic));
		mic.applyConstraints.mockRejectedValue(new Error("ended"));

		await expect(processor.destroy()).resolves.toBeUndefined();
	});
});

describe("o atalho do pressionar para falar", () => {
	it("apertar e soltar chega ao portão da cadeia publicada", async () => {
		const fake = fakeAudio();
		const processor = createInputProcessor({ ...OPTIONS, mode: "ptt" }, fake.audio);
		await processor.init(options(micTrack()));

		setPushToTalkHeld(true);
		expect(isPushToTalkHeld()).toBe(true);
		expect(fake.lastParams()).toMatchObject({ mode: "ptt", held: true });

		setPushToTalkHeld(false);
		expect(fake.lastParams()).toMatchObject({ mode: "ptt", held: false });
	});

	it("uma cadeia que entra com o atalho apertado já começa aberta", async () => {
		setPushToTalkHeld(true);
		const fake = fakeAudio();
		const processor = createInputProcessor({ ...OPTIONS, mode: "ptt" }, fake.audio);

		await processor.init(options(micTrack()));

		expect(fake.lastParams()).toMatchObject({ held: true });
	});

	it("depois de sair, o atalho não fala com a cadeia velha", async () => {
		const fake = fakeAudio();
		const processor = createInputProcessor({ ...OPTIONS, mode: "ptt" }, fake.audio);
		await processor.init(options(micTrack()));
		await processor.destroy();
		const sent = fake.gate.port.postMessage.mock.calls.length;

		setPushToTalkHeld(true);

		expect(fake.gate.port.postMessage).toHaveBeenCalledTimes(sent);
	});
});

/**
 * Uma sala com o microfone publicado, com o LiveKit de verdade no que importa: `setProcessor`
 * entrega ao `init` o microfone original e chama o `destroy` do anterior. O `swapGate` segura a
 * troca, para o teste emendar outra no meio.
 */
function callRoom({ swapGate = Promise.resolve(), published = true } = {}) {
	const mic = micTrack();
	let current: InputProcessor | undefined;
	const track = {
		getProcessor: vi.fn(() => current),
		setProcessor: vi.fn(async (next: InputProcessor) => {
			await swapGate;
			await current?.destroy();
			await next.init(options(mic));
			current = next;
		}),
	};
	const room = {
		localParticipant: {
			getTrackPublication: () => (published ? { track } : undefined),
		},
	} as unknown as Room;
	return { room, track: track as unknown as LocalAudioTrack & typeof track, mic };
}

describe("aplicar as opções na chamada", () => {
	it("põe a cadeia; repetir com as mesmas opções não troca", async () => {
		const fake = fakeAudio();
		const { room, track, mic } = callRoom();
		const create = vi.fn((o: ChainOptions) => createInputProcessor(o, fake.audio));

		await applyInputChain(room, OPTIONS, create);
		await applyInputChain(room, OPTIONS, create);

		expect(track.setProcessor).toHaveBeenCalledTimes(1);
		expect(track.getProcessor()?.name).toBe(INPUT_PROCESSOR);
		expect(mic.applyConstraints).toHaveBeenLastCalledWith(WITH_RNNOISE);
	});

	it("o volume e a sensibilidade mudam sem trocar a cadeia", async () => {
		const fake = fakeAudio();
		const { room, track } = callRoom();
		const create = (o: ChainOptions) => createInputProcessor(o, fake.audio);
		await applyInputChain(room, OPTIONS, create);

		await applyInputChain(room, { ...OPTIONS, volume: 120, thresholdDb: -40 }, create);

		expect(track.setProcessor).toHaveBeenCalledTimes(1);
		expect(fake.gain.gain.value).toBeCloseTo(1.2);
		expect(fake.lastParams()).toMatchObject({ thresholdDb: -40 });
	});

	it("desligar a supressão troca a cadeia e devolve a supressão do navegador", async () => {
		const { room, track, mic } = callRoom();
		const create = (o: ChainOptions) => createInputProcessor(o, fakeAudio().audio);
		await applyInputChain(room, OPTIONS, create);

		await applyInputChain(room, { ...OPTIONS, suppression: false }, create);

		expect(track.setProcessor).toHaveBeenCalledTimes(2);
		expect(mic.applyConstraints).toHaveBeenLastCalledWith(WITHOUT_RNNOISE);
	});

	it("sem o microfone publicado, não faz nada", async () => {
		const { room, track } = callRoom({ published: false });
		await expect(applyInputChain(room, OPTIONS)).resolves.toBeUndefined();
		expect(track.setProcessor).not.toHaveBeenCalled();
	});

	it("se o LiveKit recusa o processador, fica no log", async () => {
		const { room, track } = callRoom();
		track.setProcessor.mockRejectedValue(
			new Error("Audio context needs to be set on LocalAudioTrack"),
		);

		await expect(applyInputChain(room, OPTIONS)).resolves.toBeUndefined();
		expect(console.warn).toHaveBeenCalled();
	});

	it("desligar e ligar depressa termina ligado: as trocas andam em fila", async () => {
		let release: () => void = () => {};
		const swapGate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { room, track } = callRoom({ swapGate });
		const create = (o: ChainOptions) => createInputProcessor(o, fakeAudio().audio);

		const off = applyInputChain(room, { ...OPTIONS, suppression: false }, create);
		const on = applyInputChain(room, OPTIONS, create);
		release();
		await Promise.all([off, on]);

		expect(track.setProcessor).toHaveBeenCalledTimes(2);
		expect((track.getProcessor() as InputProcessor | undefined)?.key).toBe(
			createInputProcessor(DEFAULT_INPUT).key,
		);
	});
});
