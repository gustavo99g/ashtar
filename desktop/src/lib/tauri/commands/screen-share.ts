/**
 * Compartilhamento de tela. Espelha `media/sources.rs`, `media/audio.rs`, `media/quality.rs` e
 * `commands/screen_share.rs`. Mudou lá, muda aqui.
 */
import { Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { call } from "./core";

export type SourceRef =
	| { kind: "window"; id: number }
	| { kind: "monitor"; id: number };

export interface MonitorInfo {
	x: number;
	y: number;
	width: number;
	height: number;
	isPrimary: boolean;
}

export interface CaptureSource {
	source: SourceRef;
	title: string;
	processId: number | null;
	icon: string | null;
	monitor: MonitorInfo | null;
}

export type AudioMode =
	| { mode: "off" }
	| { mode: "application"; processId: number }
	| { mode: "system" };

export type Quality = "720p60" | "900p60" | "1080p30";

export interface StartOptions {
	source: SourceRef;
	quality: Quality;
	audio: AudioMode;
}

export type ScreenShareEndReason = "stopped" | "sourceClosed" | "error";

export interface ScreenShareEnded {
	sessionId: number;
	reason: ScreenShareEndReason;
	message: string | null;
}

export function listCaptureSources() {
	return call<CaptureSource[]>("list_capture_sources");
}

export interface IpcScreenShareHandlers {
	/** Um frame I420 com cabeçalho (formato em `media/ipc_sink.rs`). Exige ACK. */
	onVideoFrame: (frame: ArrayBuffer) => void;
	/** Amostras f32 intercaladas, estéreo, 48 kHz. */
	onAudioSamples: (samples: Float32Array) => void;
}

/**
 * Inicia o compartilhamento pelo caminho IPC e devolve o id da sessão.
 *
 * Atenção: os primeiros frames podem chegar **antes** de a Promise resolver
 * (a captura já está rodando quando o Rust responde). Quem chama precisa
 * guardar esses ACKs e enviá-los quando o id chegar.
 */
export function ipcScreenShareStart(
	options: StartOptions,
	handlers: IpcScreenShareHandlers,
) {
	const video = new Channel<ArrayBuffer>();
	video.onmessage = handlers.onVideoFrame;

	const audio = new Channel<ArrayBuffer>();
	audio.onmessage = (buffer) =>
		handlers.onAudioSamples(new Float32Array(buffer));

	return call<number>("ipc_screen_share_start", { options, video, audio });
}

export function ipcScreenShareAck(sessionId: number) {
	return call<void>("ipc_screen_share_ack", { sessionId });
}

export function screenShareStop(sessionId: number) {
	return call<void>("screen_share_stop", { sessionId });
}

/**
 * Escuta o fim de um compartilhamento. Resolve com a função que cancela a
 * escuta; aguarde a Promise **antes** de iniciar, para não perder o evento de
 * uma sessão que termina logo.
 */
export function onScreenShareEnded(
	callback: (event: ScreenShareEnded) => void,
): Promise<UnlistenFn> {
	return listen<ScreenShareEnded>("screen-share-ended", (event) =>
		callback(event.payload),
	);
}

/** Escuta a queda só do áudio (o vídeo continua, decisão 7 do PLAN). */
export function onScreenShareAudioEnded(
	callback: (event: ScreenShareEnded) => void,
): Promise<UnlistenFn> {
	return listen<ScreenShareEnded>("screen-share-audio-ended", (event) =>
		callback(event.payload),
	);
}
