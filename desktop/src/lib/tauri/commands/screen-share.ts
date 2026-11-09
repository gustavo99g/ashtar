/**
 * Compartilhamento de tela. Espelha `media/sources.rs`, `media/audio.rs`, `media/quality.rs`,
 * `media/video.rs` e `commands/screen_share.rs`. Mudou lá, muda aqui.
 */
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
	/** Janela minimizada: o seletor mostra o selo e o ícone no lugar da imagem. */
	minimized: boolean;
}

export type AudioMode =
	| { mode: "off" }
	| { mode: "application"; processId: number }
	| { mode: "system" };

export type Quality = "720p60" | "1080p60" | "1080p30";

export type ScreenShareEndReason = "stopped" | "sourceClosed" | "error";

export interface ScreenShareEnded {
	sessionId: number;
	reason: ScreenShareEndReason;
	message: string | null;
}

export function listCaptureSources() {
	return call<CaptureSource[]>("list_capture_sources");
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

// ---------------------------------------------------------------------------
// Transmissão nativa
// ---------------------------------------------------------------------------

/** Onde a conexão `:screen` entra: o que o `voice/screen-token` devolve, mais o nome da trilha. */
export interface ShareTarget {
	url: string;
	token: string;
	/** `shareTrackName`: quando começou, a qualidade e o título, lidos por todos na sala. */
	trackName: string;
}

export interface ShareOptions {
	source: SourceRef;
	quality: Quality;
	audio: AudioMode;
	cursor: boolean;
	/** O nivelador do áudio (`media/leveler.rs`): sobe o som baixo do jogo, sem estourar. */
	leveler: boolean;
	target: ShareTarget;
}

/** Um ajuste no meio da transmissão. Quem assiste não sai da tela. */
export type ShareUpdate =
	| { kind: "quality"; quality: Quality }
	| { kind: "source"; source: SourceRef }
	| { kind: "audio"; audio: AudioMode }
	| { kind: "cursor"; enabled: boolean }
	| { kind: "paused"; paused: boolean }
	| { kind: "leveler"; enabled: boolean };

export type EncoderKind =
	| { kind: "hardware"; name: string }
	| { kind: "software" };

/** Os números do último segundo (`screen-share-stats`). */
export interface ShareStats {
	sessionId: number;
	encoder: EncoderKind;
	adapter: string;
	width: number;
	height: number;
	fps: number;
	bitrateKbps: number;
	/** O que a LiveKit pede agora, limitado ao preset. Bem abaixo do preset: a rede está limitando. */
	targetKbps: number;
	latencyMs: number;
	keyframes: number;
	dropped: number;
	paused: boolean;
}

/**
 * Começa a transmissão nativa e devolve o id da sessão. Só responde depois que tudo começou (ou
 * nada ficou rodando). Escute o fim (`onScreenShareEnded`) antes de chamar.
 */
export function screenShareStart(options: ShareOptions) {
	return call<number>("screen_share_start", { options });
}

export function screenShareUpdate(sessionId: number, update: ShareUpdate) {
	return call<void>("screen_share_update", { sessionId, update });
}

/** Encerra a transmissão. Um id que já acabou não é erro. */
export function screenShareStop(sessionId: number) {
	return call<void>("screen_share_stop", { sessionId });
}

/** Escuta os números da transmissão, a cada segundo. */
export function onScreenShareStats(
	callback: (stats: ShareStats) => void,
): Promise<UnlistenFn> {
	return listen<ShareStats>("screen-share-stats", (event) =>
		callback(event.payload),
	);
}
