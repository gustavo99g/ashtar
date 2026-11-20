/*
 * Os avisos do compartilhamento saem das mudanças de estado que o controller já emite. Esta
 * função só decide, comparando o estado de antes com o de agora; quem escuta o controller
 * (`ShareNotices`, na voz) desenha o aviso.
 */
import type { CaptureSource } from "@/lib/tauri/commands";
import type { ScreenShareState } from "./controller";

export type ShareNotice =
	/** A janela ou a tela compartilhada sumiu e a transmissão acabou sozinha. */
	| { kind: "ended"; source: CaptureSource }
	/** Só o áudio caiu; o vídeo continua (decisão 7). */
	| { kind: "audioLost"; source: CaptureSource }
	/** A conexão da transmissão caiu; a captura segue, e o app tenta voltar (v0.6). */
	| { kind: "linkLost" }
	/** A conexão voltou. */
	| { kind: "linkBack" }
	/** Não deu para começar, ou a captura falhou no meio. */
	| { kind: "failed"; errorKind: string; message: string };

export function shareNotice(
	previous: ScreenShareState,
	next: ScreenShareState,
): ShareNotice | null {
	if (
		previous.status === "active" &&
		next.status === "idle" &&
		next.ended === "sourceClosed"
	) {
		return { kind: "ended", source: previous.source };
	}
	if (
		previous.status === "active" &&
		next.status === "active" &&
		previous.sessionId === next.sessionId &&
		previous.audio === "on" &&
		next.audio === "lost"
	) {
		return { kind: "audioLost", source: next.source };
	}
	if (
		previous.status === "active" &&
		next.status === "active" &&
		previous.sessionId === next.sessionId &&
		previous.link !== next.link
	) {
		return { kind: next.link === "lost" ? "linkLost" : "linkBack" };
	}
	if (next.status === "error" && previous.status !== "error") {
		return { kind: "failed", errorKind: next.kind, message: next.message };
	}
	return null;
}
