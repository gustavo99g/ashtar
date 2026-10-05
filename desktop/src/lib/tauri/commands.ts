/**
 * Único ponto de contato com `invoke()`. Nenhum outro arquivo do frontend
 * deve importar `invoke` de `@tauri-apps/api/core` diretamente — a regra
 * `no-restricted-imports` do ESLint garante isso (ver eslint.config.js).
 *
 * Cada comando Tauri ganha um wrapper tipado aqui. Comandos legados (em
 * `src-tauri/src/legacy`) ainda rejeitam a Promise com uma `string`; o
 * `call()` normaliza isso para o mesmo formato de `AppError` que os
 * comandos novos (Etapa 2.2 do PLAN.md) já devolvem.
 */
import { Channel, type InvokeArgs, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ---------------------------------------------------------------------------
// Erro
// ---------------------------------------------------------------------------

export type AppErrorKind =
	| "SourceNotFound"
	| "AlreadySharing"
	| "VideoCapture"
	| "AudioCapture"
	| "Internal"
	| "Unsupported";

export interface AppError {
	kind: AppErrorKind;
	message: string;
}

export function isAppError(value: unknown): value is AppError {
	return (
		typeof value === "object" &&
		value !== null &&
		"kind" in value &&
		"message" in value
	);
}

async function call<T>(command: string, args?: InvokeArgs): Promise<T> {
	try {
		return await invoke<T>(command, args);
	} catch (error) {
		if (isAppError(error)) {
			throw error;
		}

		// Comandos legados rejeitam com string.
		throw {
			kind: "Internal",
			message: String(error),
		} satisfies AppError;
	}
}

// ---------------------------------------------------------------------------
// Fontes de captura (janelas e monitores) e preview
// ---------------------------------------------------------------------------

export interface WindowSource {
	id: number;
	title: string;
	process_id: number;
	icon: string | null;
}

export interface MonitorSource {
	id: number;
	name: string;
	x: number;
	y: number;
	width: number;
	height: number;
	is_primary: boolean;
}

export type ScreenShareSelection =
	| {
			type: "window";
			source: WindowSource;
	  }
	| {
			type: "monitor";
			source: MonitorSource;
	  };

export type PreviewSourceType = "window" | "monitor";

export interface WindowPreviewFrame {
	source_id: number;
	source_type: PreviewSourceType;
	mime_type: string;
	data: number[];
}

export function listScreenShareWindows() {
	return call<WindowSource[]>("list_screen_share_windows");
}

export function listScreenShareMonitors() {
	return call<MonitorSource[]>("list_screen_share_monitors");
}

export function startWindowPreview(
	sourceId: number,
	onFrame: (frame: WindowPreviewFrame) => void,
) {
	const channel = new Channel<WindowPreviewFrame>();

	channel.onmessage = onFrame;

	return call<void>("start_window_preview", {
		sourceId,
		channel,
	});
}

export function startMonitorPreview(
	sourceId: number,
	onFrame: (frame: WindowPreviewFrame) => void,
) {
	const channel = new Channel<WindowPreviewFrame>();

	channel.onmessage = onFrame;

	return call<void>("start_monitor_preview", {
		sourceId,
		channel,
	});
}

export function stopAllScreenSharePreviews() {
	return call<void>("stop_all_screen_share_previews");
}

export function testListWebrtcWindows() {
	return call<void>("test_list_webrtc_windows");
}

// ---------------------------------------------------------------------------
// Captura de vídeo (DesktopCapturer)
// ---------------------------------------------------------------------------

export function startLivekitWindowCapture(
	sourceId: number,
	channel: Channel<ArrayBuffer>,
) {
	return call<number>("test_livekit_window_capture", {
		sourceId,
		channel,
	});
}

export function ackLivekitWindowCapture(captureId: number) {
	return call<void>("ack_livekit_window_capture", {
		captureId,
	});
}

export function stopLivekitWindowCapture(captureId: number) {
	return call<void>("stop_livekit_window_capture", {
		captureId,
	});
}

// ---------------------------------------------------------------------------
// Captura de áudio
// ---------------------------------------------------------------------------

export type ScreenShareAudioOptions =
	| {
			mode: "application";
			processId: number;
	  }
	| {
			mode: "system";
			processId: number;
	  };

export function startScreenShareAudio(
	options: ScreenShareAudioOptions,
	onChunk: (chunk: number[]) => void,
) {
	const channel = new Channel<number[]>();

	channel.onmessage = (chunk) => {
		onChunk(chunk);
	};

	return call<number>("start_screen_share_audio", {
		channel,
		processId: options.processId,
		application: options.mode === "application",
	});
}

export function stopScreenShareAudio(captureId: number) {
	return call<void>("stop_screen_share_audio", {
		captureId,
	});
}

// ---------------------------------------------------------------------------
// Compartilhamento de tela (comandos novos, Etapa 4)
// Espelha `media/sources.rs`, `media/audio.rs`, `media/quality.rs` e
// `commands/screen_share.rs`. Mudou lá, muda aqui.
// ---------------------------------------------------------------------------

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
