/**
 * A transmissão nativa (ADR 0017): o Rust captura, codifica e publica a tela numa conexão própria,
 * `{id}:screen`. Aqui só se pede o token à API, se chama os comandos e se acompanha o estado.
 *
 * Regras:
 *
 * - Uma sessão por vez. `start` é ignorado enquanto existir uma.
 * - O início nunca é interrompido no meio: `stop` e `dispose` esperam ele terminar, e os fins que
 *   chegam durante ele são guardados e tratados no final.
 * - As escutas dos eventos começam antes do `screenShareStart`, para não perder um fim precoce.
 * - A conexão caiu (v0.6, ADR 0030): a captura segue no Rust, e daqui se pede um token novo e se
 *   volta, esperando cada vez mais entre as tentativas ([`RETRY_DELAYS_MS`]). Quem desiste é o Rust,
 *   depois de 2 minutos, com o fim de sempre.
 */
import { ApiError, createScreenToken } from "@/lib/api";
import {
	isAppError,
	listCaptureSources,
	onScreenShareAudioEnded,
	onScreenShareEnded,
	onScreenShareLinkLost,
	onScreenShareStats,
	type ScreenShareEnded,
	type ScreenShareLinkLost,
	type ShareStats,
	type ShareUpdate,
	screenShareReconnect,
	screenShareStart,
	screenShareStop,
	screenShareUpdate,
} from "@/lib/tauri/commands";
import type {
	ScreenShareController,
	ScreenShareState,
	ShareChange,
	ShareRequest,
} from "../model/controller";
import { shareTrackName } from "../model/shareInfo";
import { useShareDefaults } from "../stores/shareDefaultsStore";

/** A espera antes de cada tentativa de voltar a conexão; a última se repete. */
export const RETRY_DELAYS_MS = [1000, 2000, 5000, 10_000, 20_000, 30_000];

interface Session {
	/** `null` até o `screenShareStart` responder. */
	id: number | null;
	/** O nome da trilha, o mesmo na volta: quem assiste continua vendo a mesma transmissão. */
	trackName: string;
	unlisten: (() => void)[];
	/** Fins (e quedas) que chegaram antes do id. */
	early: {
		ended: ScreenShareEnded[];
		audioEnded: ScreenShareEnded[];
		linkLost: ScreenShareLinkLost[];
	};
	closed: boolean;
	/** A volta em andamento, para não começar outra. */
	reconnecting: boolean;
	/** A espera da próxima tentativa, para o fim da sessão cancelar. */
	retryTimer: ReturnType<typeof setTimeout> | null;
}

type ActiveState = Extract<ScreenShareState, { status: "active" }>;

export class NativeScreenShare implements ScreenShareController {
	private readonly channelId: string;
	private readonly listeners = new Set<(state: ScreenShareState) => void>();
	private readonly statsListeners = new Set<
		(stats: ShareStats | null) => void
	>();
	private state: ScreenShareState = { status: "idle" };
	private stats: ShareStats | null = null;
	private session: Session | null = null;
	private startPromise: Promise<void> | null = null;
	private disposed = false;

	/** `channelId`: a sala de voz em que a pessoa está, para o token da `:screen`. */
	constructor(channelId: string) {
		this.channelId = channelId;
	}

	getState(): ScreenShareState {
		return this.state;
	}

	onStateChange(listener: (state: ScreenShareState) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	getStats(): ShareStats | null {
		return this.stats;
	}

	onStats(listener: (stats: ShareStats | null) => void): () => void {
		this.statsListeners.add(listener);
		return () => {
			this.statsListeners.delete(listener);
		};
	}

	listSources() {
		return listCaptureSources();
	}

	private setState(next: ScreenShareState) {
		this.state = next;
		for (const listener of this.listeners) listener(next);
	}

	private setStats(next: ShareStats | null) {
		this.stats = next;
		for (const listener of this.statsListeners) listener(next);
	}

	// -----------------------------------------------------------------------
	// Início
	// -----------------------------------------------------------------------

	async start(request: ShareRequest): Promise<void> {
		// Checagem e reserva no mesmo tick, antes de qualquer `await`.
		if (this.disposed || this.session !== null) return;
		const session: Session = {
			id: null,
			// Quando começou, a qualidade e o título: a ordem das transmissões e quem assiste leem
			// daqui (`shareInfo.ts`).
			trackName: shareTrackName({
				startedAt: Date.now(),
				quality: request.quality,
				title: request.source.title,
			}),
			unlisten: [],
			early: { ended: [], audioEnded: [], linkLost: [] },
			closed: false,
			reconnecting: false,
			retryTimer: null,
		};
		this.session = session;
		this.setState({ status: "starting" });
		this.startPromise = this.runStart(session, request);
		await this.startPromise;
		this.startPromise = null;
	}

	private async runStart(session: Session, request: ShareRequest) {
		try {
			session.unlisten.push(
				await onScreenShareEnded((event) => this.handleEnded(session, event)),
			);
			session.unlisten.push(
				await onScreenShareAudioEnded((event) =>
					this.handleAudioEnded(session, event),
				),
			);
			session.unlisten.push(
				await onScreenShareLinkLost((event) =>
					this.handleLinkLost(session, event),
				),
			);
			session.unlisten.push(
				await onScreenShareStats((stats) => {
					if (stats.sessionId === session.id && !session.closed) {
						this.setStats(stats);
					}
				}),
			);

			const { url, token } = await createScreenToken(this.channelId);
			session.id = await screenShareStart({
				source: request.source.source,
				quality: request.quality,
				audio: request.audio,
				cursor: request.cursor,
				leveler: request.leveler ?? true,
				hardwareEncoder: useShareDefaults.getState().hardwareEncoder,
				target: { url, token, trackName: session.trackName },
			});
		} catch (error) {
			this.close(session);
			this.setState(toErrorState(error));
			return;
		}

		const audioOn = request.audio.mode !== "off";
		this.setState({
			status: "active",
			sessionId: session.id,
			source: request.source,
			quality: request.quality,
			audioMode: request.audio,
			startedAt: Date.now(),
			cursor: request.cursor,
			leveler: request.leveler ?? true,
			paused: false,
			audio: audioOn ? "on" : "off",
			link: "ok",
		});

		// O que chegou antes do id.
		const ended = session.early.ended.find((e) => e.sessionId === session.id);
		if (ended) {
			this.endFromRust(session, ended);
			return;
		}
		if (session.early.audioEnded.some((e) => e.sessionId === session.id)) {
			this.markAudioLost();
		}
		const lost = session.early.linkLost.find((e) => e.sessionId === session.id);
		if (lost) this.handleLinkLost(session, lost);
	}

	// -----------------------------------------------------------------------
	// Eventos do Rust
	// -----------------------------------------------------------------------

	private handleEnded(session: Session, event: ScreenShareEnded) {
		if (session.id === null) {
			session.early.ended.push(event);
		} else if (event.sessionId === session.id) {
			this.endFromRust(session, event);
		}
	}

	private handleAudioEnded(session: Session, event: ScreenShareEnded) {
		if (session.id === null) {
			session.early.audioEnded.push(event);
		} else if (event.sessionId === session.id) {
			this.markAudioLost();
		}
	}

	private handleLinkLost(session: Session, event: ScreenShareLinkLost) {
		if (session.id === null) {
			session.early.linkLost.push(event);
			return;
		}
		if (event.sessionId !== session.id || session.closed) return;
		this.setLink(session.id, "lost");
		if (!session.reconnecting) {
			session.reconnecting = true;
			this.retry(session, 0);
		}
	}

	/** Espera e tenta voltar a conexão; falhando, agenda a próxima, até a sessão acabar. */
	private retry(session: Session, attempt: number) {
		const delay =
			RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
		session.retryTimer = setTimeout(() => {
			session.retryTimer = null;
			void this.reconnect(session).then((back) => {
				if (session.closed) return;
				if (back) {
					session.reconnecting = false;
				} else {
					this.retry(session, attempt + 1);
				}
			});
		}, delay);
	}

	/** Uma tentativa: um token novo e a volta. Devolve se voltou (ou se nem precisa mais). */
	private async reconnect(session: Session): Promise<boolean> {
		const id = session.id;
		if (session.closed || id === null) return true;
		try {
			const { url, token } = await createScreenToken(this.channelId);
			if (session.closed) return true;
			await screenShareReconnect(id, {
				url,
				token,
				trackName: session.trackName,
			});
		} catch (error) {
			console.warn("A transmissão ainda não voltou:", error);
			return false;
		}
		if (!session.closed) this.setLink(id, "ok");
		return true;
	}

	private setLink(sessionId: number, link: "ok" | "lost") {
		const state = this.state;
		if (
			state.status === "active" &&
			state.sessionId === sessionId &&
			state.link !== link
		) {
			this.setState({ ...state, link });
		}
	}

	/** O Rust já encerrou (fonte fechada, conexão caiu, erro): só limpa o lado de cá. */
	private endFromRust(session: Session, event: ScreenShareEnded) {
		if (session.closed) return;
		this.close(session);
		this.setState(
			event.reason === "error"
				? {
						status: "error",
						kind: "Publish",
						message: event.message ?? "A transmissão parou.",
					}
				: event.reason === "sourceClosed"
					? { status: "idle", ended: "sourceClosed" }
					: { status: "idle" },
		);
	}

	private markAudioLost() {
		if (this.state.status === "active" && this.state.audio === "on") {
			this.setState({ ...this.state, audio: "lost" });
		}
	}

	// -----------------------------------------------------------------------
	// Ajustes
	// -----------------------------------------------------------------------

	async update(change: ShareChange): Promise<void> {
		const state = this.state;
		if (state.status !== "active") return;
		await screenShareUpdate(state.sessionId, toUpdate(change));
		// A sessão pode ter acabado durante a chamada.
		if (this.state.status !== "active") return;
		if (this.state.sessionId !== state.sessionId) return;
		this.setState(applyChange(this.state, change));
	}

	// -----------------------------------------------------------------------
	// Encerramento
	// -----------------------------------------------------------------------

	async stop(): Promise<void> {
		await this.startPromise;
		const session = this.session;
		if (!session) return;
		const id = session.id;
		this.close(session);
		if (id !== null) {
			try {
				await screenShareStop(id);
			} catch (error) {
				console.warn("Erro ao parar a transmissão no Rust:", error);
			}
		}
		this.setState({ status: "idle" });
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		await this.stop();
		this.listeners.clear();
		this.statsListeners.clear();
	}

	/** Desfaz o lado de cá da sessão. Chamadas repetidas não fazem nada. */
	private close(session: Session) {
		if (session.closed) return;
		session.closed = true;
		if (session.retryTimer !== null) clearTimeout(session.retryTimer);
		session.retryTimer = null;
		for (const unlisten of session.unlisten) unlisten();
		if (this.session === session) this.session = null;
		this.setStats(null);
	}
}

function toUpdate(change: ShareChange): ShareUpdate {
	return change.kind === "source"
		? { kind: "source", source: change.source.source }
		: change;
}

function applyChange(state: ActiveState, change: ShareChange): ActiveState {
	switch (change.kind) {
		case "quality":
			return { ...state, quality: change.quality };
		case "source":
			return { ...state, source: change.source };
		case "audio":
			return {
				...state,
				audioMode: change.audio,
				audio: change.audio.mode === "off" ? "off" : "on",
			};
		case "cursor":
			return { ...state, cursor: change.enabled };
		case "paused":
			return { ...state, paused: change.paused };
		case "leveler":
			return { ...state, leveler: change.enabled };
	}
}

function toErrorState(error: unknown): ScreenShareState {
	if (isAppError(error)) {
		return { status: "error", kind: error.kind, message: error.message };
	}
	// Da API, como o `share_limit` (a sala já tem o máximo de transmissões): a mensagem dela.
	if (error instanceof ApiError) {
		return { status: "error", kind: error.kind, message: error.message };
	}
	return {
		status: "error",
		kind: "Internal",
		message: error instanceof Error ? error.message : String(error),
	};
}
