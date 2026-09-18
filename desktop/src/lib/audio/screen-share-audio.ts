import {
	type ScreenShareAudioOptions,
	startScreenShareAudio,
} from "@/lib/tauri/audio";
import workletUrl from "./screen-share-audio.worklet.js?url";

export class ScreenShareAudio {
	private readonly context: AudioContext;
	private readonly worklet: AudioWorkletNode;
	private readonly destination: MediaStreamAudioDestinationNode;

	private constructor(
		context: AudioContext,
		worklet: AudioWorkletNode,
		destination: MediaStreamAudioDestinationNode,
	) {
		this.context = context;
		this.worklet = worklet;
		this.destination = destination;
	}

	static async create(): Promise<ScreenShareAudio> {
		const context = new AudioContext({
			sampleRate: 48_000,
		});

		if (context.sampleRate !== 48_000) {
			await context.close();

			throw new Error(
				`AudioContext usa ${context.sampleRate}Hz, esperado 48000Hz`,
			);
		}

		await context.audioWorklet.addModule(workletUrl);

		const worklet = new AudioWorkletNode(
			context,
			"screen-share-audio-processor",
			{
				numberOfInputs: 0,
				numberOfOutputs: 1,
				outputChannelCount: [2],
			},
		);

		const destination = context.createMediaStreamDestination();

		worklet.connect(destination);

		return new ScreenShareAudio(context, worklet, destination);
	}

	async start(options: ScreenShareAudioOptions): Promise<MediaStreamTrack> {
		await this.context.resume();

		await startScreenShareAudio(options, (chunk) => {
			console.log("Chunk:", chunk.constructor.name, "length:", chunk.length);

			const bytes = new Uint8Array(chunk);

			if (bytes.byteLength % 4 !== 0) {
				console.error("Chunk de áudio inválido:", bytes.byteLength);
				return;
			}

			const view = new Float32Array(
				bytes.buffer,
				bytes.byteOffset,
				bytes.byteLength / 4,
			);

			const samples = new Float32Array(view);

			this.worklet.port.postMessage(samples);
		});

		const track = this.destination.stream.getAudioTracks()[0];

		if (!track) {
			throw new Error("Não foi possível criar o MediaStreamTrack de áudio");
		}

		return track;
	}

	async stop(): Promise<void> {
		this.worklet.disconnect();

		for (const track of this.destination.stream.getAudioTracks()) {
			track.stop();
		}

		await this.context.close();
	}
}
