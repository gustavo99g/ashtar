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
import { Channel, invoke, type InvokeArgs } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// Erro
// ---------------------------------------------------------------------------

export type AppErrorKind =
	| "SourceNotFound"
	| "AlreadySharing"
	| "VideoCapture"
	| "AudioCapture"
	| "Internal";

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
