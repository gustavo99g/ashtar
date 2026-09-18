import { Channel, invoke } from "@tauri-apps/api/core";

export type ScreenShareAudioOptions =
	| {
			mode: "application";
			processId: number;
	  }
	| {
			mode: "system";
			processId: number;
	  };

export async function startScreenShareAudio(
	options: ScreenShareAudioOptions,
	onChunk: (chunk: number[]) => void,
) {
	const channel = new Channel<number[]>();

	channel.onmessage = (chunk) => {
		console.log("Chunk recebido no React:", chunk.length);
		onChunk(chunk);
	};

	await invoke("start_screen_share_audio", {
		channel,
		processId: options.processId,
		application: options.mode === "application",
	});
}
