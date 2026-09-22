export {};

declare global {
	interface MediaStreamTrackGeneratorOptions {
		kind: "audio" | "video";
	}

	interface MediaStreamTrackGenerator extends MediaStreamTrack {
		readonly writable: WritableStream<VideoFrame>;
	}

	interface MediaStreamTrackGeneratorConstructor {
		new (options: MediaStreamTrackGeneratorOptions): MediaStreamTrackGenerator;
	}

	var MediaStreamTrackGenerator: MediaStreamTrackGeneratorConstructor;
}
