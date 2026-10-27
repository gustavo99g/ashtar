/**
 * Compartilhamento pelo caminho IPC (ADR 0007): o Rust captura e manda os frames I420 e os
 * blocos de áudio pelo `Channel`; aqui eles viram trilhas publicadas na sala do LiveKit.
 *
 * Concentra tudo que uma sessão cria (generator, áudio, escutas dos eventos, publicações) num
 * objeto `Session`, desfeito por um único `teardown`. Regras:
 *
 * - Uma sessão por vez. `start` é ignorado enquanto existir uma, inclusive durante o teardown.
 * - O início nunca é interrompido no meio: `stop`/`dispose` esperam ele terminar, e eventos de
 *   fim que chegam durante ele são guardados e tratados no final.
 * - Frames que chegam antes do id da sessão têm o ACK guardado e enviado quando o id chega.
 */
import { AudioPresets, type Room, Track } from "livekit-client";
import {
	ipcScreenShareAck,
	ipcScreenShareStart,
	isAppError,
	listCaptureSources,
	onScreenShareAudioEnded,
	onScreenShareEnded,
	type ScreenShareEnded,
	screenShareStop,
} from "@/lib/tauri/commands";
import type {
	ScreenShareController,
	ScreenShareState,
	ShareRequest,
} from "../controller";
import { QUALITY_PRESETS } from "../presets";
import { shareTrackName } from "../shareInfo";
import { ScreenShareAudio } from "./ScreenShareAudio";

/**
 * Cabeçalho do `IpcVideoSink` (`VIDEO_HEADER_LEN` no `ipc_sink.rs`): largura e altura (u32) e o
 * `timestamp_us` da captura (i64), little endian. Mudou lá, muda aqui.
 */
const FRAME_HEADER_BYTES = 16;

interface Session {
	/** `null` até o `ipcScreenShareStart` responder. */
	id: number | null;
	starting: boolean;
	/** ACKs de frames que chegaram antes do id. */
	pendingAcks: number;
	generator: MediaStreamTrackGenerator;
	writer: WritableStreamDefaultWriter<VideoFrame>;
	audio: ScreenShareAudio | null;
	/** Trilhas entregues ao LiveKit (ou em publicação), para despublicar no teardown. */
	published: MediaStreamTrack[];
	unlisten: (() => void)[];
	/** Eventos que chegaram durante o início, tratados quando ele termina. */
	endedDuringStart: ScreenShareEnded[];
	audioEndedDuringStart: ScreenShareEnded[];
	/** O Rust já encerrou a sessão; não precisa chamar `screenShareStop`. */
	endedByRust: boolean;
	teardown: Promise<void> | null;
}

export class IpcScreenShare implements ScreenShareController {
	private readonly room: Room;
	private readonly listeners = new Set<(state: ScreenShareState) => void>();
	private state: ScreenShareState = { status: "idle" };
	private session: Session | null = null;
	private startPromise: Promise<void> | null = null;
	private disposed = false;

	constructor(room: Room) {
		this.room = room;
	}

	// -----------------------------------------------------------------------
	// Estado
	// -----------------------------------------------------------------------

	getState(): ScreenShareState {
		return this.state;
	}

	onStateChange(listener: (state: ScreenShareState) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private setState(next: ScreenShareState) {
		this.state = next;
		for (const listener of this.listeners) {
			listener(next);
		}
	}

	listSources() {
		return listCaptureSources();
	}

	// -----------------------------------------------------------------------
	// Início
	// -----------------------------------------------------------------------

	async start(request: ShareRequest): Promise<void> {
		// Checagem e reserva no mesmo tick, antes de qualquer `await`: um segundo clique
		// encontra `this.session` preenchido e não faz nada.
		if (this.disposed || this.session !== null) {
			return;
		}

		const generator = new MediaStreamTrackGenerator({ kind: "video" });
		const session: Session = {
			id: null,
			starting: true,
			pendingAcks: 0,
			generator,
			writer: generator.writable.getWriter(),
			audio: null,
			published: [],
			unlisten: [],
			endedDuringStart: [],
			audioEndedDuringStart: [],
			endedByRust: false,
			teardown: null,
		};

		this.session = session;
		this.setState({ status: "starting" });

		this.startPromise = this.runStart(session, request);
		await this.startPromise;
		this.startPromise = null;
	}

	private async runStart(session: Session, request: ShareRequest) {
		try {
			// 1. O áudio do webview fica pronto antes de o Rust começar a mandar blocos.
			if (request.audio.mode !== "off") {
				session.audio = await ScreenShareAudio.create();
			}

			// 2. Escuta os eventos antes de iniciar, para não perder um fim precoce.
			//    Um push por escuta: se a segunda falhar, a primeira já está guardada para o teardown.
			session.unlisten.push(
				await onScreenShareEnded((event) => this.handleEnded(session, event)),
			);
			session.unlisten.push(
				await onScreenShareAudioEnded((event) =>
					this.handleAudioEnded(session, event),
				),
			);

			// 3. Inicia no Rust. O início é atômico: ou volta o id, ou nada ficou rodando.
			session.id = await ipcScreenShareStart(
				{
					source: request.source.source,
					quality: request.quality,
					audio: request.audio,
				},
				{
					onVideoFrame: (frame) => void this.handleFrame(session, frame),
					onAudioSamples: (samples) => session.audio?.push(samples),
				},
			);
			this.flushPendingAcks(session);

			// 4. Publica no LiveKit, com o encoder configurado pelo preset.
			const preset = QUALITY_PRESETS[request.quality];
			session.generator.contentHint = preset.contentHint;

			session.published.push(session.generator);

			await this.room.localParticipant.publishTrack(session.generator, {
				source: Track.Source.ScreenShare,
				// Quando começou, a qualidade e o título: a regra de uma transmissão por vez e quem
				// assiste leem daqui (`shareInfo.ts`).
				name: shareTrackName({
					startedAt: Date.now(),
					quality: request.quality,
					title: request.source.title,
				}),
				stream: "screen-share",
				screenShareEncoding: {
					maxBitrate: preset.maxBitrate,
					maxFramerate: preset.maxFramerate,
				},
				degradationPreference: preset.degradationPreference,
				videoCodec: preset.videoCodec,
				simulcast: false,
			});

			if (session.audio) {
				session.published.push(session.audio.track);

				await this.room.localParticipant.publishTrack(session.audio.track, {
					source: Track.Source.ScreenShareAudio,
					name: "screen-share-audio",
					stream: "screen-share",
					audioPreset: AudioPresets.musicHighQualityStereo,
					dtx: false,
					forceStereo: true,
				});
			}
		} catch (error) {
			session.starting = false;
			await this.teardown(session);
			this.setState(toErrorState(error));
			return;
		}

		session.starting = false;
		this.setState({
			status: "active",
			sessionId: session.id,
			source: request.source,
			audio: session.audio ? "on" : "off",
		});

		// 5. Trata o que chegou durante o início.
		const ended = session.endedDuringStart.find(
			(event) => event.sessionId === session.id,
		);
		if (ended) {
			this.endFromRust(session, ended);
			return;
		}

		if (
			session.audioEndedDuringStart.some(
				(event) => event.sessionId === session.id,
			)
		) {
			void this.dropAudio(session);
		}
	}

	// -----------------------------------------------------------------------
	// Frames e ACKs
	// -----------------------------------------------------------------------

	private async handleFrame(session: Session, buffer: ArrayBuffer) {
		try {
			if (session.teardown) {
				return;
			}

			const header = new DataView(buffer, 0, FRAME_HEADER_BYTES);
			const width = header.getUint32(0, true);
			const height = header.getUint32(4, true);
			const timestampUs = Number(header.getBigInt64(8, true));

			const chromaWidth = Math.ceil(width / 2);
			const chromaHeight = Math.ceil(height / 2);
			const ySize = width * height;
			const uvSize = chromaWidth * chromaHeight;

			// Uma view sobre o mesmo buffer, sem copiar: a única cópia é a do próprio VideoFrame.
			const frame = new VideoFrame(new Uint8Array(buffer, FRAME_HEADER_BYTES), {
				format: "I420",
				codedWidth: width,
				codedHeight: height,
				// Microssegundos desde o início da captura, medidos no Rust com `Instant`.
				timestamp: timestampUs,
				layout: [
					{ offset: 0, stride: width },
					{ offset: ySize, stride: chromaWidth },
					{ offset: ySize + uvSize, stride: chromaWidth },
				],
			});

			try {
				await session.writer.write(frame);
			} finally {
				frame.close();
			}
		} catch (error) {
			if (!session.teardown) {
				console.error("Erro ao processar frame do compartilhamento:", error);
			}
		} finally {
			// ACK mesmo em erro: sem ele o FrameGate fecha e a captura para de mandar.
			this.ack(session);
		}
	}

	private ack(session: Session) {
		if (session.id === null) {
			session.pendingAcks += 1;
			return;
		}
		if (!session.teardown) {
			ipcScreenShareAck(session.id).catch(() => {});
		}
	}

	private flushPendingAcks(session: Session) {
		const pending = session.pendingAcks;
		session.pendingAcks = 0;
		for (let i = 0; i < pending; i++) {
			this.ack(session);
		}
	}

	// -----------------------------------------------------------------------
	// Eventos do Rust
	// -----------------------------------------------------------------------

	private handleEnded(session: Session, event: ScreenShareEnded) {
		if (session.starting) {
			session.endedDuringStart.push(event);
			return;
		}
		if (event.sessionId === session.id) {
			this.endFromRust(session, event);
		}
	}

	private handleAudioEnded(session: Session, event: ScreenShareEnded) {
		if (session.starting) {
			session.audioEndedDuringStart.push(event);
			return;
		}
		if (event.sessionId === session.id) {
			void this.dropAudio(session);
		}
	}

	/** O Rust encerrou a sessão (fonte fechada, erro ou parada): só limpa o lado de cá. */
	private endFromRust(session: Session, event: ScreenShareEnded) {
		session.endedByRust = true;

		void this.teardown(session).then(() => {
			if (this.session !== null) {
				return;
			}
			this.setState(
				event.reason === "error"
					? {
							status: "error",
							kind: "VideoCapture",
							message: event.message ?? "A captura de vídeo parou.",
						}
					: { status: "idle" },
			);
		});
	}

	/** Só o áudio caiu: despublica a trilha dele e o vídeo continua (decisão 7). */
	private async dropAudio(session: Session) {
		const audio = session.audio;
		if (!audio || session.teardown) {
			return;
		}

		session.audio = null;
		session.published = session.published.filter((t) => t !== audio.track);

		try {
			await this.room.localParticipant.unpublishTrack(audio.track);
		} catch (error) {
			console.warn("Erro ao despublicar o áudio do compartilhamento:", error);
		}
		await audio.close();

		if (this.state.status === "active") {
			this.setState({ ...this.state, audio: "lost" });
		}
	}

	// -----------------------------------------------------------------------
	// Encerramento
	// -----------------------------------------------------------------------

	async stop(): Promise<void> {
		await this.startPromise;

		const session = this.session;
		if (!session) {
			return;
		}

		await this.teardown(session);
		this.setState({ status: "idle" });
	}

	async dispose(): Promise<void> {
		if (this.disposed) {
			return;
		}
		this.disposed = true;

		await this.stop();
		this.listeners.clear();
	}

	/** Desfaz tudo que a sessão criou. Chamadas repetidas recebem a mesma Promise. */
	private teardown(session: Session): Promise<void> {
		session.teardown ??= this.runTeardown(session);
		return session.teardown;
	}

	private async runTeardown(session: Session) {
		for (const unlisten of session.unlisten) {
			unlisten();
		}

		// Primeiro para a fonte, para não chegarem mais frames nem blocos de áudio.
		if (session.id !== null && !session.endedByRust) {
			try {
				await screenShareStop(session.id);
			} catch (error) {
				console.warn("Erro ao parar o compartilhamento no Rust:", error);
			}
		}

		for (const track of session.published) {
			try {
				await this.room.localParticipant.unpublishTrack(track);
			} catch (error) {
				console.warn("Erro ao despublicar trilha do compartilhamento:", error);
			}
		}

		try {
			await session.writer.close();
		} catch {
			// O stream pode já ter sido encerrado pelo navegador.
		}
		session.generator.stop();

		await session.audio?.close();

		if (this.session === session) {
			this.session = null;
		}
	}
}

function toErrorState(error: unknown): ScreenShareState {
	if (isAppError(error)) {
		return { status: "error", kind: error.kind, message: error.message };
	}
	return {
		status: "error",
		kind: "Internal",
		message: error instanceof Error ? error.message : String(error),
	};
}
