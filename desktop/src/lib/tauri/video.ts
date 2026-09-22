import { Channel, invoke } from "@tauri-apps/api/core";

export type ScreenShareVideoSource =
	| {
			type: "window";
			sourceId: number;
	  }
	| {
			type: "monitor";
			sourceId: number;
	  };

export class ScreenShareVideo {
	private readonly canvas: HTMLCanvasElement;

	private readonly context: CanvasRenderingContext2D;
	private readonly stream: MediaStream;
	private readonly track: MediaStreamTrack;
	private receivedFrames = 0;
	private lastFpsLog = performance.now();

	private captureActive = false;
	private processingFrame = false;
	private pendingFrame: ArrayBuffer | null = null;

	private constructor() {
		this.canvas = document.createElement("canvas");

		this.canvas.width = 1280;
		this.canvas.height = 720;

		const context = this.canvas.getContext("2d", {
			alpha: false,
		});

		if (!context) {
			throw new Error("Não foi possível criar contexto 2D.");
		}

		this.context = context;

		this.context.fillStyle = "black";
		this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);

		this.stream = this.canvas.captureStream(30);

		const track = this.stream.getVideoTracks()[0];

		if (!track) {
			throw new Error("Canvas não criou MediaStreamTrack.");
		}

		this.track = track;
	}

	static create(): ScreenShareVideo {
		return new ScreenShareVideo();
	}

	async start(source: ScreenShareVideoSource): Promise<MediaStreamTrack> {
		if (this.captureActive) {
			throw new Error("Screen share já está ativo.");
		}

		this.captureActive = true;

		const channel = new Channel<ArrayBuffer>();

		channel.onmessage = (data) => {
			this.receivedFrames++;

			const now = performance.now();

			if (now - this.lastFpsLog >= 1000) {
				console.log("Channel FPS:", this.receivedFrames);

				this.receivedFrames = 0;
				this.lastFpsLog = now;
			}

			this.enqueueFrame(data);
		};

		await invoke<void>("start_screen_share_video", {
			sourceType: source.type,
			sourceId: source.sourceId,
			channel,
		});

		return this.track;
	}

	private enqueueFrame(data: ArrayBuffer) {
		this.pendingFrame = data;
		console.log(data.byteLength);

		void this.processFrame();
	}

	private async processFrame() {
		if (this.processingFrame) {
			return;
		}

		this.processingFrame = true;

		try {
			while (this.pendingFrame) {
				const data = this.pendingFrame;
				this.pendingFrame = null;

				const blob = new Blob([data], {
					type: "image/jpeg",
				});

				const bitmap = await createImageBitmap(blob);

				this.context.fillStyle = "black";

				this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);

				const scale = Math.min(
					this.canvas.width / bitmap.width,
					this.canvas.height / bitmap.height,
				);

				const width = bitmap.width * scale;
				const height = bitmap.height * scale;

				const x = (this.canvas.width - width) / 2;

				const y = (this.canvas.height - height) / 2;

				this.context.drawImage(bitmap, x, y, width, height);

				bitmap.close();
			}
		} finally {
			this.processingFrame = false;
		}
	}

	async stop() {
		if (!this.captureActive) {
			return;
		}

		this.captureActive = false;

		await invoke("stop_screen_share_video");

		this.track.stop();

		this.stream.getTracks().forEach((track) => {
			track.stop();
		});

		this.pendingFrame = null;
	}
}
