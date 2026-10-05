/**
 * Transforma os blocos de áudio do Rust (f32 estéreo intercalado, 48 kHz) numa
 * `MediaStreamTrack` que o LiveKit consegue publicar.
 *
 * Não fala com o Rust: quem recebe os blocos (a `IpcScreenShare`) chama `push`. Por isso
 * `close()` não tem como falhar no meio e deixar o `AudioContext` aberto.
 */
import workletUrl from "./jitter-buffer.worklet.js?url";

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const STATS_INTERVAL_MS = 1_000;

interface JitterStats {
	bufferedMs: number;
	underruns: number;
	droppedFrames: number;
}

export class ScreenShareAudio {
	readonly track: MediaStreamTrack;

	private readonly context: AudioContext;
	private readonly node: AudioWorkletNode;
	private readonly statsTimer: number | null = null;
	private closed = false;

	private constructor(
		context: AudioContext,
		node: AudioWorkletNode,
		track: MediaStreamTrack,
	) {
		this.context = context;
		this.node = node;
		this.track = track;

		if (import.meta.env.DEV) {
			this.node.port.onmessage = (event: MessageEvent<JitterStats>) => {
				const { bufferedMs, underruns, droppedFrames } = event.data;
				console.debug(
					`[screen-share-audio] buffer ${bufferedMs.toFixed(0)} ms, ` +
						`${underruns} esvaziamentos, ${droppedFrames} frames descartados`,
				);
			};
			this.statsTimer = window.setInterval(
				() => this.node.port.postMessage("stats"),
				STATS_INTERVAL_MS,
			);
		}
	}

	static async create(): Promise<ScreenShareAudio> {
		const context = new AudioContext({ sampleRate: SAMPLE_RATE });

		try {
			if (context.sampleRate !== SAMPLE_RATE) {
				throw new Error(
					`AudioContext usa ${context.sampleRate} Hz, esperado ${SAMPLE_RATE} Hz`,
				);
			}

			await context.audioWorklet.addModule(workletUrl);

			const node = new AudioWorkletNode(context, "jitter-buffer", {
				numberOfInputs: 0,
				numberOfOutputs: 1,
				outputChannelCount: [2],
			});

			const destination = context.createMediaStreamDestination();
			node.connect(destination);

			const track = destination.stream.getAudioTracks()[0];
			if (!track) {
				throw new Error("O AudioContext não criou a trilha de áudio");
			}

			await context.resume();

			return new ScreenShareAudio(context, node, track);
		} catch (error) {
			await context.close().catch(() => {});
			throw error;
		}
	}

	/**
	 * Entrega um bloco (f32 estéreo intercalado) ao worklet. O buffer é transferido, não
	 * copiado: depois desta chamada, `samples` fica vazio aqui.
	 */
	push(samples: Float32Array): void {
		if (this.closed) {
			return;
		}

		if (samples.length === 0 || samples.length % CHANNELS !== 0) {
			console.warn(
				`Bloco de áudio com tamanho inválido: ${samples.length} amostras`,
			);
			return;
		}

		this.node.port.postMessage(samples, [samples.buffer]);
	}

	/** Libera tudo. Pode ser chamado mais de uma vez e nunca rejeita. */
	async close(): Promise<void> {
		if (this.closed) {
			return;
		}
		this.closed = true;

		if (this.statsTimer !== null) {
			window.clearInterval(this.statsTimer);
		}
		this.node.port.onmessage = null;
		this.node.disconnect();
		this.track.stop();

		try {
			await this.context.close();
		} catch (error) {
			console.warn("Erro ao fechar o AudioContext do compartilhamento:", error);
		}
	}
}
