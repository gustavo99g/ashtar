/**
 * Único ponto de contato com `invoke()`. Nenhum outro arquivo do frontend
 * deve importar `invoke` de `@tauri-apps/api/core` diretamente — a regra
 * `no-restricted-imports` do ESLint garante isso (ver eslint.config.js).
 *
 * Cada comando Tauri ganha um wrapper tipado aqui. Os comandos rejeitam a Promise com um `AppError`
 * (Etapa 2.2 do docs/plans/v0.1-reorganizacao.md); o `call()` converte qualquer outra rejeição (por exemplo, um erro do próprio
 * Tauri, que chega como `string`) para o mesmo formato.
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
	| "Unsupported"
	| "Update";

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

		// Rejeição que não é um `AppError` (ex.: erro do próprio Tauri, que chega como string).
		throw {
			kind: "Internal",
			message: String(error),
		} satisfies AppError;
	}
}

// ---------------------------------------------------------------------------
// Compartilhamento de tela (Etapa 4)
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

export interface UpdateReady {
	version: string;
}

export interface UpdateFailed {
	message: string;
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

/** A versão já baixada esperando o "reiniciar", ou `null`. */
export function pendingUpdate() {
	return call<string | null>("pending_update");
}

/** Instala a versão baixada e reinicia o app. Se der certo, não resolve: o app fecha. */
export function installUpdate() {
	return call<void>("install_update");
}

/** Pede uma verificação agora. O resultado chega por `onUpdateReady`/`onUpdateFailed`. */
export function checkForUpdate() {
	return call<void>("check_for_update");
}

export function onUpdateReady(
	callback: (event: UpdateReady) => void,
): Promise<UnlistenFn> {
	return listen<UpdateReady>("update-ready", (event) =>
		callback(event.payload),
	);
}

export function onUpdateFailed(
	callback: (event: UpdateFailed) => void,
): Promise<UnlistenFn> {
	return listen<UpdateFailed>("update-failed", (event) =>
		callback(event.payload),
	);
}

// ---------------------------------------------------------------------------
// App (Etapa 7 da v0.2.0)
// Espelha `commands/app.rs`.
// ---------------------------------------------------------------------------

export interface WhatsNew {
	version: string;
	notes: string;
}

/** A seção do CHANGELOG.md da versão em execução, ou `null`. */
export function whatsNew() {
	return call<WhatsNew | null>("whats_new");
}
