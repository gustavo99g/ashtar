/**
 * Contrato do compartilhamento de tela, independente de como os dados chegam ao LiveKit.
 *
 * Hoje a única implementação é a `IpcScreenShare` (o Rust manda os frames pelo IPC e o
 * webview os publica). O publicador nativo e uma eventual versão web serão outras
 * implementações desta mesma interface: o provider e a UI só conhecem o que está aqui.
 */
import type { AudioMode, CaptureSource, Quality } from "@/lib/tauri/commands";

/** O que o usuário escolheu no seletor. */
export interface ShareRequest {
	source: CaptureSource;
	quality: Quality;
	audio: AudioMode;
}

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
			/** `lost`: o áudio caiu sozinho e o vídeo continua (decisão 7). */
			audio: "off" | "on" | "lost";
	  }
	| { status: "error"; kind: string; message: string };

export interface ScreenShareController {
	/** Estado atual. Devolve sempre o mesmo objeto enquanto o estado não muda. */
	getState(): ScreenShareState;

	/** Avisa a cada mudança de estado. Devolve a função que cancela o aviso. */
	onStateChange(listener: (state: ScreenShareState) => void): () => void;

	listSources(): Promise<CaptureSource[]>;

	/** Nunca rejeita: uma falha vira o estado `error`. Ignorado se já houver uma sessão. */
	start(request: ShareRequest): Promise<void>;

	/** Nunca rejeita. Se houver um início em andamento, espera ele terminar e então para. */
	stop(): Promise<void>;

	/** Para o que estiver ativo e desliga o controller para sempre. */
	dispose(): Promise<void>;
}
