/**
 * A cadeia do microfone (ADR 0029): o volume de entrada, o RNNoise (se ligado) e o portão da
 * detecção de voz e do pressionar para falar, nessa ordem, num `AudioContext` só. O LiveKit entrega
 * a trilha do microfone a este processador e manda para a sala a trilha que sai dele
 * (`processedTrack`). Desde a v0.6 ela fica sempre na trilha, porque o portão precisa estar no
 * caminho; na v0.2.3 a v0.5 era só o RNNoise, e só com a supressão ligada.
 *
 * **O processador entra depois de o microfone ser publicado**, nunca pelas opções da sala
 * (`audioCaptureDefaults.processor`): o LiveKit aplicaria o processador ao criar a trilha, antes de
 * ela ter o `AudioContext`, e recusaria ("Audio context needs to be set on LocalAudioTrack"). Quem
 * chama é o `VoiceProvider`, no `LocalTrackPublished` e quando uma opção muda ([`applyInputChain`]).
 *
 * O que muda o grafo (a supressão, o eco e o ganho automático, que são restrições da captura) troca
 * o processador inteiro; o volume e a sensibilidade mudam no grafo que já existe, sem cortar a voz.
 *
 * As restrições da trilha do microfone são da cadeia: a supressão do navegador e o RNNoise juntos
 * abafam a voz, então ela a desliga quando o RNNoise está na trilha, e a liga quando não está.
 *
 * O RNNoise trabalha a 48 kHz. O contexto de áudio do LiveKit segue a placa de som (pode ser
 * 44,1 kHz), então a cadeia tem o seu, fixo em 48 kHz, e o navegador converte na entrada.
 *
 * Se o RNNoise não carregar (sem wasm), a cadeia segue sem ele, com a supressão do navegador. Se a
 * cadeia inteira falhar (sem AudioWorklet), a chamada não cai: a trilha segue sem processar.
 */
import rnnoiseWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseSimdWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import rnnoiseWorkletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import {
	type AudioProcessorOptions,
	type LocalAudioTrack,
	type Room,
	Track,
	type TrackProcessor,
} from "livekit-client";
import type { GateParams } from "./model/gate";
import { emitInputLevel, type InputLevel } from "./model/levelBus";
import type { InputChoice } from "./stores/inputStore";

/** As peças do Web Audio, trocáveis no teste (o jsdom não tem `AudioContext`). */
export interface InputAudio {
	createContext: () => AudioContext;
	/** O wasm do RNNoise, com SIMD quando o webview tem. Carregado uma vez. */
	loadWasm: () => Promise<ArrayBuffer>;
	addRnnoiseWorklet: (context: AudioContext) => Promise<void>;
	createRnnoise: (
		context: AudioContext,
		wasm: ArrayBuffer,
	) => Promise<AudioWorkletNode & { destroy?: () => void }>;
	addGateWorklet: (context: AudioContext) => Promise<void>;
	createGate: (context: AudioContext) => AudioWorkletNode;
}

/*
 * A biblioteca do RNNoise entra sob demanda: ela estende o `AudioWorkletNode` ao carregar, e o
 * arquivo dela (com o wasm) só baixa na primeira entrada numa sala. O portão também.
 */
const library = () => import("@sapphi-red/web-noise-suppressor");
const gateWorklet = () => import("./worklet/gate.worklet.ts?worker&url");

let wasm: Promise<ArrayBuffer> | null = null;

const browserAudio: InputAudio = {
	createContext: () =>
		new AudioContext({ sampleRate: 48_000, latencyHint: "interactive" }),
	loadWasm: () => {
		wasm ??= library()
			.then(({ loadRnnoise }) =>
				loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl }),
			)
			.catch((error: unknown) => {
				// Uma falha não fica guardada: a próxima entrada na sala tenta de novo.
				wasm = null;
				throw error;
			});
		return wasm;
	},
	addRnnoiseWorklet: (context) =>
		context.audioWorklet.addModule(rnnoiseWorkletUrl),
	createRnnoise: async (context, binary) => {
		const { RnnoiseWorkletNode } = await library();
		return new RnnoiseWorkletNode(context, {
			wasmBinary: binary,
			maxChannels: 1,
		});
	},
	addGateWorklet: async (context) => {
		const { default: url } = await gateWorklet();
		await context.audioWorklet.addModule(url);
	},
	createGate: (context) =>
		new AudioWorkletNode(context, GATE_PROCESSOR, {
			numberOfInputs: 1,
			numberOfOutputs: 1,
			outputChannelCount: [1],
		}),
};

export const INPUT_PROCESSOR = "ashtar-input";
export const GATE_PROCESSOR = "ashtar-gate";

/** O que a cadeia precisa das opções do microfone. */
export type ChainOptions = Pick<
	InputChoice,
	| "suppression"
	| "echoCancellation"
	| "autoGainControl"
	| "volume"
	| "mode"
	| "autoSensitivity"
	| "thresholdDb"
>;

/** As opções que exigem refazer o grafo; as outras mudam no grafo que já existe. */
function structureKey(options: ChainOptions): string {
	return [
		options.suppression,
		options.echoCancellation,
		options.autoGainControl,
	].join("|");
}

/** As restrições da captura, com ou sem o RNNoise na cadeia. */
export function captureConstraints(
	options: Pick<ChainOptions, "echoCancellation" | "autoGainControl">,
	rnnoise: boolean,
): MediaTrackConstraints {
	return {
		noiseSuppression: !rnnoise,
		echoCancellation: options.echoCancellation,
		autoGainControl: options.autoGainControl,
	};
}

/** Troca as restrições de uma trilha de microfone. Uma trilha que já terminou as recusa: sem erro. */
async function setConstraints(
	track: MediaStreamTrack,
	constraints: MediaTrackConstraints,
): Promise<void> {
	await track
		.applyConstraints({ ...track.getConstraints(), ...constraints })
		.catch(() => {});
}

/** O atalho do pressionar para falar, que não é opção guardada: vale para a cadeia de agora. */
let held = false;

function gateParams(options: ChainOptions): GateParams {
	return {
		mode: options.mode,
		auto: options.autoSensitivity,
		thresholdDb: options.thresholdDb,
		held,
	};
}

/** O grafo montado sobre um microfone: a trilha que sai e os controles ao vivo. */
export interface InputGraph {
	output: MediaStreamTrack;
	/** O RNNoise ficou na cadeia (pode ter falhado ao carregar). */
	rnnoise: boolean;
	update: (options: ChainOptions) => void;
	close: () => Promise<void>;
}

/**
 * Monta a cadeia sobre `track`: volume → RNNoise (se `suppression`) → portão. Quem usa: o
 * processador da trilha publicada e o teste de microfone de Voz e vídeo. Lança se o portão não
 * carregar.
 */
export async function buildInputGraph(
	track: MediaStreamTrack,
	options: ChainOptions,
	onLevel: (level: InputLevel) => void = emitInputLevel,
	audio: InputAudio = browserAudio,
): Promise<InputGraph> {
	const context = audio.createContext();
	const nodes: { disconnect: () => void; destroy?: () => void }[] = [];
	try {
		await audio.addGateWorklet(context);
		const source = context.createMediaStreamSource(new MediaStream([track]));
		const gain = context.createGain();
		gain.gain.value = options.volume / 100;
		nodes.push(source, gain);

		let rnnoise: (AudioWorkletNode & { destroy?: () => void }) | null = null;
		if (options.suppression) {
			try {
				const binary = await audio.loadWasm();
				await audio.addRnnoiseWorklet(context);
				rnnoise = await audio.createRnnoise(context, binary);
				nodes.push(rnnoise);
			} catch (error) {
				console.warn("Supressão de ruído desligada nesta trilha:", error);
				rnnoise = null;
			}
		}

		const gate = audio.createGate(context);
		nodes.push(gate);
		gate.port.onmessage = (event: MessageEvent<InputLevel>) =>
			onLevel(event.data);
		gate.port.postMessage({ params: gateParams(options) });

		const destination = context.createMediaStreamDestination();
		source.connect(gain);
		const afterGain = rnnoise ? gain.connect(rnnoise) : gain;
		afterGain.connect(gate).connect(destination);
		// Um contexto criado sem clique pode nascer suspenso.
		if (context.state === "suspended") await context.resume();

		const output = destination.stream.getAudioTracks()[0];
		return {
			output,
			rnnoise: rnnoise !== null,
			update: (next) => {
				gain.gain.value = next.volume / 100;
				gate.port.postMessage({ params: gateParams(next) });
			},
			close: async () => {
				for (const node of nodes) {
					node.disconnect();
					node.destroy?.();
				}
				output.stop();
				await context.close().catch(() => {});
			},
		};
	} catch (error) {
		for (const node of nodes) node.disconnect();
		await context.close().catch(() => {});
		throw error;
	}
}

/** O processador do microfone publicado agora, para os controles ao vivo (o atalho). */
let active: InputProcessor | null = null;

/** O atalho do pressionar para falar apertado ou solto. Vale na hora, na cadeia publicada. */
export function setPushToTalkHeld(next: boolean): void {
	if (held === next) return;
	held = next;
	active?.refresh();
}

export function isPushToTalkHeld(): boolean {
	return held;
}

export type InputProcessor = TrackProcessor<
	Track.Kind.Audio,
	AudioProcessorOptions
> & {
	/** As opções que montaram o grafo ([`structureKey`]). */
	key: string;
	/** Opções novas com a mesma `key`: o volume e o portão mudam no grafo de agora. */
	update: (options: ChainOptions) => void;
	/** Reenvia as opções de agora (o atalho mudou). */
	refresh: () => void;
};

/** Um processador novo por trilha: ele guarda o grafo de áudio e o microfone que recebeu. */
export function createInputProcessor(
	options: ChainOptions,
	audio: InputAudio = browserAudio,
): InputProcessor {
	let graph: InputGraph | null = null;
	/** O microfone de verdade, o que o LiveKit entregou em `init`. */
	let raw: MediaStreamTrack | null = null;
	/** As opções de agora: começam as da criação e mudam pelo `update`. */
	let latest = options;

	async function release() {
		if (active === processor) active = null;
		const closing = graph;
		graph = null;
		processor.processedTrack = undefined;
		await closing?.close();
	}

	const processor: InputProcessor = {
		name: INPUT_PROCESSOR,
		key: structureKey(options),
		processedTrack: undefined,

		update(next) {
			latest = next;
			graph?.update(latest);
		},

		refresh() {
			graph?.update(latest);
		},

		async init({ track }) {
			raw = track;
			try {
				graph = await buildInputGraph(track, latest, emitInputLevel, audio);
				processor.processedTrack = graph.output;
				active = processor;
				// Só agora, com a cadeia pronta, o navegador larga a supressão dele (se o RNNoise entrou).
				await setConstraints(
					track,
					captureConstraints(options, graph.rnnoise),
				);
			} catch (error) {
				console.warn("A cadeia do microfone não carregou nesta trilha:", error);
				await release();
				await setConstraints(track, captureConstraints(options, false));
			}
		},

		// Trocar de microfone: o LiveKit entrega a trilha nova, sem o contexto.
		async restart(next) {
			await release();
			await processor.init(next);
		},

		async destroy() {
			await release();
			// Sem a cadeia, o microfone volta a contar com a supressão do navegador.
			if (raw) await setConstraints(raw, captureConstraints(options, false));
			raw = null;
		},
	};

	return processor;
}

/** O que cada sala ainda está trocando: uma troca só começa quando a anterior termina. */
const applying = new WeakMap<Room, Promise<void>>();

/**
 * Deixa o microfone publicado como as opções mandam: põe a cadeia, troca por uma nova (se mudou a
 * supressão, o eco ou o ganho automático) ou só atualiza o volume e o portão. Sem microfone
 * publicado, não faz nada. Uma falha fica no log, e a chamada segue como estava.
 *
 * As trocas de uma sala andam em fila. Mudar depressa, sem isso, deixaria a segunda ver a cadeia
 * antiga ainda ativa, achar que já está certo e sair.
 */
export function applyInputChain(
	room: Room,
	options: ChainOptions,
	createProcessor: (options: ChainOptions) => InputProcessor = (o) =>
		createInputProcessor(o),
): Promise<void> {
	const previous = applying.get(room) ?? Promise.resolve();
	const next = previous
		.catch(() => {})
		.then(() => apply(room, options, createProcessor));
	applying.set(room, next);
	return next;
}

async function apply(
	room: Room,
	options: ChainOptions,
	createProcessor: (options: ChainOptions) => InputProcessor,
): Promise<void> {
	const track = room.localParticipant.getTrackPublication(
		Track.Source.Microphone,
	)?.track as LocalAudioTrack | undefined;
	if (!track) return;
	const current = track.getProcessor() as Partial<InputProcessor> | undefined;
	if (
		current?.name === INPUT_PROCESSOR &&
		current.key === structureKey(options) &&
		current.update
	) {
		current.update(options);
		return;
	}
	try {
		await track.setProcessor(createProcessor(options));
	} catch (error) {
		console.warn("Não foi possível trocar a cadeia do microfone:", error);
	}
}
