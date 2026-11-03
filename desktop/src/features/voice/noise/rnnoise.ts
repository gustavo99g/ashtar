/**
 * A supressão de ruído do microfone, uma opção de Configurações › Voz e vídeo desde a v0.2.3
 * (`stores/noiseStore.ts`, ligada por padrão). Ligada, é o RNNoise, uma rede pequena que
 * separa voz de ruído (teclado, ventilador, o jogo no fundo), rodando num AudioWorklet do próprio
 * webview. O LiveKit entrega a trilha do microfone a este processador e manda para a sala a
 * trilha que sai dele (`processedTrack`). Desligada, o microfone fica como o LiveKit o abre: com a
 * supressão do próprio navegador, sem processador.
 *
 * **O processador entra depois de o microfone ser publicado**, nunca pelas opções da sala
 * (`audioCaptureDefaults.processor`): o LiveKit aplicaria o processador ao criar a trilha, antes de
 * ela ter o `AudioContext`, e recusaria ("Audio context needs to be set on LocalAudioTrack"). Quem
 * chama é o `VoiceProvider`, no `LocalTrackPublished` e quando a opção muda
 * ([`switchNoiseSuppression`]).
 *
 * As restrições da trilha do microfone são do processador: a supressão do navegador e o RNNoise
 * juntos abafam a voz, então ele a desliga quando o RNNoise está na trilha (`MIC_CONSTRAINTS`) e a
 * devolve quando sai ou falha (`BROWSER_CONSTRAINTS`). Até o RNNoise ficar pronto, a trilha segue
 * com a supressão do navegador.
 *
 * O RNNoise trabalha a 48 kHz. O contexto de áudio do LiveKit segue a placa de som (pode ser
 * 44,1 kHz), então o processador tem o seu, fixo em 48 kHz, e o navegador converte na entrada.
 *
 * Se o RNNoise não carregar (sem AudioWorklet, wasm que falha), a chamada não cai: a trilha segue
 * sem processar, com a supressão do próprio navegador.
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

/** As peças do Web Audio, trocáveis no teste (o jsdom não tem `AudioContext`). */
export interface NoiseAudio {
	createContext: () => AudioContext;
	/** O wasm do RNNoise, com SIMD quando o webview tem. Carregado uma vez. */
	loadWasm: () => Promise<ArrayBuffer>;
	addWorklet: (context: AudioContext) => Promise<void>;
	createNode: (
		context: AudioContext,
		wasm: ArrayBuffer,
	) => Promise<AudioWorkletNode & { destroy?: () => void }>;
}

/*
 * A biblioteca entra sob demanda: ela estende o `AudioWorkletNode` ao carregar, e o arquivo
 * dela (com o wasm) só baixa na primeira entrada numa sala.
 */
const library = () => import("@sapphi-red/web-noise-suppressor");

let wasm: Promise<ArrayBuffer> | null = null;

const browserAudio: NoiseAudio = {
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
	addWorklet: (context) => context.audioWorklet.addModule(rnnoiseWorkletUrl),
	createNode: async (context, binary) => {
		const { RnnoiseWorkletNode } = await library();
		return new RnnoiseWorkletNode(context, {
			wasmBinary: binary,
			maxChannels: 1,
		});
	},
};

/**
 * As restrições do microfone com o RNNoise na trilha: a supressão do navegador desligada (as duas
 * juntas abafam a voz), o cancelamento de eco e o ganho automático ligados.
 */
export const MIC_CONSTRAINTS = {
	noiseSuppression: false,
	echoCancellation: true,
	autoGainControl: true,
} as const;

/** Sem o RNNoise: as restrições padrão do LiveKit, com a supressão do navegador ligada. */
export const BROWSER_CONSTRAINTS = {
	noiseSuppression: true,
	echoCancellation: true,
	autoGainControl: true,
} as const;

export const RNNOISE_NAME = "ashtar-rnnoise";

/** Troca as restrições de uma trilha de microfone. Uma trilha que já terminou as recusa: sem erro. */
async function setConstraints(
	track: MediaStreamTrack,
	constraints: MediaTrackConstraints,
): Promise<void> {
	await track
		.applyConstraints({ ...track.getConstraints(), ...constraints })
		.catch(() => {});
}

/** Um processador novo por trilha: ele guarda o grafo de áudio e o microfone que recebeu. */
export function createRnnoiseProcessor(
	audio: NoiseAudio = browserAudio,
): TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
	let context: AudioContext | null = null;
	let source: MediaStreamAudioSourceNode | null = null;
	let node: (AudioWorkletNode & { destroy?: () => void }) | null = null;
	/** O microfone de verdade, o que o LiveKit entregou em `init`. */
	let raw: MediaStreamTrack | null = null;

	const processor: TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> = {
		name: RNNOISE_NAME,
		processedTrack: undefined,

		async init({ track }) {
			raw = track;
			try {
				const binary = await audio.loadWasm();
				if (!context || context.state === "closed") {
					context = audio.createContext();
					await audio.addWorklet(context);
				}
				source = context.createMediaStreamSource(new MediaStream([track]));
				node = await audio.createNode(context, binary);
				const destination = context.createMediaStreamDestination();
				source.connect(node).connect(destination);
				// Um contexto criado sem clique pode nascer suspenso.
				if (context.state === "suspended") await context.resume();
				processor.processedTrack = destination.stream.getAudioTracks()[0];
				// Só agora, com o RNNoise pronto na trilha, o navegador larga a supressão dele.
				await setConstraints(track, MIC_CONSTRAINTS);
			} catch (error) {
				console.warn("Supressão de ruído desligada nesta trilha:", error);
				disconnect();
				processor.processedTrack = undefined;
				await setConstraints(track, BROWSER_CONSTRAINTS);
			}
		},

		// Trocar de microfone: o LiveKit entrega a trilha nova, sem o contexto.
		async restart(options) {
			disconnect();
			await processor.init(options);
		},

		async destroy() {
			disconnect();
			processor.processedTrack = undefined;
			// Sem o RNNoise, o microfone volta a contar com a supressão do navegador.
			if (raw) await setConstraints(raw, BROWSER_CONSTRAINTS);
			raw = null;
			await context?.close().catch(() => {});
			context = null;
		},
	};

	function disconnect() {
		source?.disconnect();
		node?.disconnect();
		node?.destroy?.();
		processor.processedTrack?.stop();
		source = null;
		node = null;
	}

	return processor;
}

/** O que cada sala ainda está trocando: uma troca só começa quando a anterior termina. */
const switching = new WeakMap<Room, Promise<void>>();

/**
 * Põe ou tira o RNNoise do microfone publicado, para a trilha ficar como a opção manda. Sem
 * microfone publicado, ou com ele já certo, não faz nada. Uma falha fica no log, e a chamada segue
 * como estava.
 *
 * As trocas de uma sala andam em fila. Ligar e desligar depressa, sem isso, deixaria a segunda
 * ver o RNNoise ainda ativo, achar que já está certo e sair, e a trilha ficaria ao contrário do
 * interruptor.
 */
export function switchNoiseSuppression(
	room: Room,
	suppression: boolean,
	createProcessor = createRnnoiseProcessor,
): Promise<void> {
	const previous = switching.get(room) ?? Promise.resolve();
	const next = previous
		.catch(() => {})
		.then(() => applySuppression(room, suppression, createProcessor));
	switching.set(room, next);
	return next;
}

async function applySuppression(
	room: Room,
	suppression: boolean,
	createProcessor: typeof createRnnoiseProcessor,
): Promise<void> {
	const track = room.localParticipant.getTrackPublication(
		Track.Source.Microphone,
	)?.track as LocalAudioTrack | undefined;
	if (!track) return;
	const on = track.getProcessor()?.name === RNNOISE_NAME;
	if (on === suppression) return;
	try {
		if (suppression) await track.setProcessor(createProcessor());
		else await track.stopProcessor();
	} catch (error) {
		console.warn("Não foi possível trocar a supressão de ruído:", error);
	}
}
