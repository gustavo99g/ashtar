/**
 * Contrato da transmissão de tela, independente de como os dados chegam ao LiveKit.
 *
 * A implementação é a `NativeScreenShare` (ADR 0017): o Rust captura, codifica e publica numa
 * conexão própria, `{id}:screen`. O provider e a UI só conhecem o que está aqui.
 */
import type {
	AudioMode,
	CaptureSource,
	Quality,
	ShareStats,
} from "@/lib/tauri/commands";

/** O que o usuário escolheu no seletor. */
export interface ShareRequest {
	source: CaptureSource;
	quality: Quality;
	audio: AudioMode;
	cursor: boolean;
}

/** Um ajuste no meio da transmissão, pelo painel ou pela bandeja. */
export type ShareChange =
	| { kind: "quality"; quality: Quality }
	| { kind: "source"; source: CaptureSource }
	| { kind: "audio"; audio: AudioMode }
	| { kind: "cursor"; enabled: boolean }
	| { kind: "paused"; paused: boolean };

export type ScreenShareState =
	| {
			status: "idle";
			/** A última sessão acabou sem ninguém pedir: a janela ou a tela compartilhada sumiu. */
			ended?: "sourceClosed";
	  }
	| { status: "starting" }
	| {
			status: "active";
			sessionId: number;
			source: CaptureSource;
			quality: Quality;
			audioMode: AudioMode;
			cursor: boolean;
			paused: boolean;
			/** `lost`: o áudio caiu sozinho e o vídeo continua. */
			audio: "off" | "on" | "lost";
	  }
	| { status: "error"; kind: string; message: string };

export interface ScreenShareController {
	/** Estado atual. Devolve sempre o mesmo objeto enquanto o estado não muda. */
	getState(): ScreenShareState;

	/** Avisa a cada mudança de estado. Devolve a função que cancela o aviso. */
	onStateChange(listener: (state: ScreenShareState) => void): () => void;

	/** Os números do último segundo, ou `null` fora de uma transmissão. */
	getStats(): ShareStats | null;

	/** Avisa a cada número novo (um por segundo). Devolve a função que cancela o aviso. */
	onStats(listener: (stats: ShareStats | null) => void): () => void;

	listSources(): Promise<CaptureSource[]>;

	/** Nunca rejeita: uma falha vira o estado `error`. Ignorado se já houver uma sessão. */
	start(request: ShareRequest): Promise<void>;

	/**
	 * Ajusta a transmissão ativa. Rejeita com o erro do Rust (um áudio que não abriu, por exemplo);
	 * a transmissão continua. Sem transmissão ativa, não faz nada.
	 */
	update(change: ShareChange): Promise<void>;

	/** Nunca rejeita. Se houver um início em andamento, espera ele terminar e então para. */
	stop(): Promise<void>;

	/** Para o que estiver ativo e desliga o controller para sempre. */
	dispose(): Promise<void>;
}
