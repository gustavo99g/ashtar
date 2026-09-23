import { RoomAudioRenderer } from "@livekit/components-react";
import { Channel } from "@tauri-apps/api/core";
import { type Participant, Room, RoomEvent, Track } from "livekit-client";
import {
	createContext,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { ScreenShareAudio } from "@/lib/audio";
import {
	ackLivekitWindowCapture,
	startLivekitWindowCapture,
	stopLivekitWindowCapture,
} from "@/lib/tauri/commands";
import { useNavigationStore } from "@/stores/navigation";

export type VoiceConnectionState =
	| "disconnected"
	| "connecting"
	| "connected"
	| "error";

interface VoiceContextValue {
	room: Room | null;
	voiceChannelId: string | null;
	participants: Participant[];
	isConnected: boolean;
	isMuted: boolean;
	isDeafened: boolean;
	isScreenSharing: boolean;
	isSomeoneScreenSharing: boolean;
	connectionState: VoiceConnectionState;
	mute: () => Promise<void>;
	unmute: () => Promise<void>;
	leave: () => Promise<void>;
	deafen: () => void;
	undeafen: () => void;
	startScreenShare: (sourceId: number, processId: number) => Promise<void>;
	stopScreenShare: () => Promise<void>;
}

export const VoiceContext = createContext<VoiceContextValue | null>(null);

interface VoiceProviderProps {
	children: ReactNode;
}

const VoiceProvider = ({ children }: VoiceProviderProps) => {
	const voiceChannelId = useNavigationStore((state) => state.voiceChannelId);
	const leaveVoiceChannel = useNavigationStore(
		(state) => state.leaveVoiceChannel,
	);

	const [room, setRoom] = useState<Room | null>(null);
	const [participants, setParticipants] = useState<Participant[]>([]);

	const [isMuted, setIsMuted] = useState(false);
	const [isDeafened, setIsDeafened] = useState(false);
	const [isScreenSharing, setIsScreenSharing] = useState(false);
	const [connectionState, setConnectionState] =
		useState<VoiceConnectionState>("disconnected");

	const isConnected = connectionState === "connected";

	const screenShareAudioRef = useRef<ScreenShareAudio | null>(null);
	const screenShareAudioTrackRef = useRef<MediaStreamTrack | null>(null);

	const screenShareWriterRef =
		useRef<WritableStreamDefaultWriter<VideoFrame> | null>(null);

	const screenShareTrackRef = useRef<MediaStreamTrack | null>(null);

	const screenShareCaptureIdRef = useRef<number | null>(null);
	const screenShareFpsRef = useRef({
		count: 0,
		lastTime: performance.now(),
	});

	/**
	 * A captura pode começar a enviar frames antes de a chamada
	 * ao Rust devolver o captureId. Mantemos a Promise para
	 * conseguir dar ACK nesses frames também.
	 */
	const screenShareCapturePromiseRef = useRef<Promise<number> | null>(null);

	const isSomeoneScreenSharing = participants.some(
		(participant) =>
			participant.isScreenShareEnabled &&
			participant.identity !== room?.localParticipant.identity,
	);

	useEffect(() => {
		if (!voiceChannelId) {
			resetVoiceState();
			setConnectionState("disconnected");
			return;
		}

		let cancelled = false;

		const nextRoom = new Room();

		async function connect() {
			try {
				setConnectionState("connecting");

				const random = crypto.randomUUID();

				const res = await fetch("http://127.0.0.1:3000/api/voice/join", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						channel_id: voiceChannelId,
						user_id: "idiot-" + random,
						display_name: "Idiota-" + random,
					}),
				});

				if (!res.ok) {
					throw new Error("Não foi possível entrar no canal de voz.");
				}

				const data: { token: string; url: string } = await res.json();

				if (cancelled) {
					return;
				}

				nextRoom.on(RoomEvent.ParticipantConnected, updateParticipants);

				nextRoom.on(RoomEvent.ParticipantDisconnected, updateParticipants);

				nextRoom.on(RoomEvent.LocalTrackPublished, updateParticipants);

				nextRoom.on(RoomEvent.LocalTrackUnpublished, updateParticipants);

				nextRoom.on(RoomEvent.TrackMuted, updateParticipants);
				nextRoom.on(RoomEvent.TrackUnmuted, updateParticipants);

				nextRoom.on(RoomEvent.Disconnected, handleDisconnected);
				nextRoom.on(RoomEvent.ActiveSpeakersChanged, updateParticipants);

				nextRoom.on(RoomEvent.TrackPublished, updateParticipants);
				nextRoom.on(RoomEvent.TrackUnpublished, updateParticipants);

				nextRoom.on(RoomEvent.TrackSubscribed, updateParticipants);
				nextRoom.on(RoomEvent.TrackUnsubscribed, updateParticipants);

				await nextRoom.connect(data.url, data.token);
				await nextRoom.localParticipant.setMicrophoneEnabled(true);

				if (cancelled) {
					await nextRoom.disconnect();
					return;
				}

				setRoom(nextRoom);
				setConnectionState("connected");
				updateParticipants();
				setIsMuted(false);
			} catch (error) {
				console.error("Erro ao conectar na voz:", error);

				if (!cancelled) {
					setRoom(null);
					setParticipants([]);
					setConnectionState("error");
				}
			}
		}

		function updateParticipants() {
			const remoteParticipants = Array.from(
				nextRoom.remoteParticipants.values(),
			);

			setParticipants([nextRoom.localParticipant, ...remoteParticipants]);
		}

		function handleDisconnected() {
			setRoom(null);
			setParticipants([]);
			setIsMuted(false);
			setConnectionState("disconnected");
		}

		void connect();

		return () => {
			cancelled = true;

			nextRoom.removeAllListeners();
			void nextRoom.disconnect();
		};
	}, [voiceChannelId]);

	/**
	 * Converte o payload I420 enviado pelo Rust em VideoFrame
	 * e entrega ao MediaStreamTrackGenerator.
	 */
	async function handleScreenShareFrame(payload: ArrayBuffer | Uint8Array) {
		screenShareFpsRef.current.count += 1;
		const writer = screenShareWriterRef.current;

		const now = performance.now();
		const elapsed = now - screenShareFpsRef.current.lastTime;

		if (elapsed >= 1000) {
			const fps = (screenShareFpsRef.current.count * 1000) / elapsed;

			console.log(`SCREEN SHARE FPS: ${fps.toFixed(1)}`);

			screenShareFpsRef.current.count = 0;
			screenShareFpsRef.current.lastTime = now;
		}

		if (!writer) {
			return;
		}

		let captureId = screenShareCaptureIdRef.current;

		try {
			/**
			 * Pode chegar um frame antes da chamada ao Rust devolver o
			 * captureId. Esperamos a Promise nesse caso para conseguir
			 * enviar o ACK.
			 */
			if (captureId === null && screenShareCapturePromiseRef.current) {
				try {
					captureId = await screenShareCapturePromiseRef.current;
				} catch {
					return;
				}
			}

			const buffer =
				payload instanceof ArrayBuffer
					? payload
					: payload.buffer.slice(
							payload.byteOffset,
							payload.byteOffset + payload.byteLength,
						);

			const view = new DataView(buffer);

			const width = view.getUint32(0, true);
			const height = view.getUint32(4, true);

			/**
			 * Header Rust:
			 *
			 * 0..4   = width
			 * 4..8   = height
			 * 8..16  = capture timestamp
			 * 16..24 = send timestamp
			 *
			 * Depois:
			 * Y + U + V
			 */

			const chromaWidth = Math.ceil(width / 2);
			const chromaHeight = Math.ceil(height / 2);

			const ySize = width * height;
			const uvSize = chromaWidth * chromaHeight;

			const frame = new VideoFrame(new Uint8Array(buffer, 24), {
				format: "I420",
				codedWidth: width,
				codedHeight: height,

				/**
				 * WebCodecs usa microssegundos.
				 *
				 * Não usamos o timestamp UNIX vindo do Rust
				 * diretamente porque ele está em outro domínio temporal.
				 */
				timestamp: Math.round(performance.now() * 1000),

				layout: [
					{
						offset: 0,
						stride: width,
					},
					{
						offset: ySize,
						stride: chromaWidth,
					},
					{
						offset: ySize + uvSize,
						stride: chromaWidth,
					},
				],
			});

			try {
				/**
				 * O ACK só acontece depois de o writer aceitar o frame.
				 *
				 * Não esperamos requestVideoFrameCallback porque esse
				 * pipeline não precisa renderizar o vídeo localmente.
				 */
				await writer.write(frame);
			} finally {
				frame.close();
			}
		} catch (error) {
			console.error("Erro ao processar frame do compartilhamento:", error);
		} finally {
			if (captureId !== null) {
				void ackLivekitWindowCapture(captureId);
			}
		}
	}

	async function mute() {
		if (!room) {
			return;
		}

		await room.localParticipant.setMicrophoneEnabled(false);
		setIsMuted(true);
	}

	async function unmute() {
		if (!room) {
			return;
		}

		await room.localParticipant.setMicrophoneEnabled(true);
		setIsMuted(false);
	}

	async function leave() {
		if (!room) {
			return;
		}

		if (isScreenSharing) {
			await stopScreenShare();
		}

		await room.disconnect();

		resetVoiceState();
		setConnectionState("disconnected");
		leaveVoiceChannel();
	}

	function deafen() {
		if (!room) {
			return;
		}

		for (const participant of room.remoteParticipants.values()) {
			for (const publication of participant.audioTrackPublications.values()) {
				publication.setSubscribed(false);
			}
		}

		setIsDeafened(true);
		void mute();
	}

	function undeafen() {
		if (!room) {
			return;
		}

		for (const participant of room.remoteParticipants.values()) {
			for (const publication of participant.audioTrackPublications.values()) {
				publication.setSubscribed(true);
			}
		}

		setIsDeafened(false);
		void unmute();
	}

	function resetVoiceState() {
		setRoom(null);
		setParticipants([]);
		setConnectionState("disconnected");
		setIsMuted(false);
		setIsDeafened(false);
		setIsScreenSharing(false);
	}

	async function startScreenShare(sourceId: number, processId: number) {
		if (!room) {
			return;
		}

		try {
			/**
			 * ==========================================
			 * 1. Cria o MediaStreamTrackGenerator
			 * ==========================================
			 */
			const generator = new MediaStreamTrackGenerator({
				kind: "video",
			});

			const writer = generator.writable.getWriter();

			screenShareWriterRef.current = writer;
			screenShareTrackRef.current = generator;

			/**
			 * ==========================================
			 * 2. Cria o Channel Rust -> JS
			 * ==========================================
			 */
			const channel = new Channel<ArrayBuffer>();

			channel.onmessage = (payload) => {
				void handleScreenShareFrame(payload);
			};

			/**
			 * ==========================================
			 * 3. Publica o track customizado no LiveKit
			 * ==========================================
			 */
			await room.localParticipant.publishTrack(generator, {
				source: Track.Source.ScreenShare,
				name: "screen-share",
				stream: "screen-share",
			});

			/**
			 * ==========================================
			 * 4. Inicia a captura Rust
			 * ==========================================
			 *
			 * Guardamos a Promise porque o Rust pode começar
			 * a enviar frames antes dessa chamada retornar.
			 */
			const capturePromise = startLivekitWindowCapture(sourceId, channel);

			screenShareCapturePromiseRef.current = capturePromise;

			const captureId = await capturePromise;

			screenShareCaptureIdRef.current = captureId;

			/**
			 * ==========================================
			 * 5. Inicia o áudio do compartilhamento
			 * ==========================================
			 */
			const audio = await ScreenShareAudio.create();

			const audioTrack = await audio.start({
				mode: "application",
				processId: processId,
			});

			await room.localParticipant.publishTrack(audioTrack, {
				source: Track.Source.ScreenShareAudio,
				name: "screen-share-audio",
				stream: "screen-share",
				forceStereo: true,
			});

			screenShareAudioRef.current = audio;
			screenShareAudioTrackRef.current = audioTrack;

			setIsScreenSharing(true);
		} catch (error) {
			console.error("Erro ao iniciar compartilhamento de tela:", error);

			/**
			 * Se alguma etapa falhar, usamos o mesmo cleanup
			 * do stopScreenShare.
			 */
			try {
				await stopScreenShare();
			} catch (cleanupError) {
				console.error(
					"Erro ao limpar compartilhamento após falha:",
					cleanupError,
				);
			}
		}
	}

	async function stopScreenShare() {
		/**
		 * Não retornamos imediatamente se room for null.
		 *
		 * O cleanup do capture/writer ainda pode ser necessário.
		 */
		try {
			/**
			 * ==========================================
			 * 1. Para a captura Rust
			 * ==========================================
			 */
			let captureId = screenShareCaptureIdRef.current;

			/**
			 * Se ainda estamos esperando a chamada ao Rust, aguardamos
			 * para descobrir o captureId antes de tentar parar.
			 */
			if (captureId === null && screenShareCapturePromiseRef.current) {
				try {
					captureId = await screenShareCapturePromiseRef.current;
				} catch {
					captureId = null;
				}
			}

			if (captureId !== null) {
				await stopLivekitWindowCapture(captureId);
			}

			/**
			 * ==========================================
			 * 2. Remove o vídeo do LiveKit
			 * ==========================================
			 */
			const videoTrack = screenShareTrackRef.current;

			if (room && videoTrack) {
				room.localParticipant.unpublishTrack(videoTrack);
			}

			if (videoTrack) {
				videoTrack.stop();
			}

			/**
			 * ==========================================
			 * 3. Fecha o writer
			 * ==========================================
			 */
			const writer = screenShareWriterRef.current;

			if (writer) {
				try {
					await writer.close();
				} catch {
					/**
					 * O stream pode já ter sido encerrado pelo browser.
					 */
				}
			}

			/**
			 * ==========================================
			 * 4. Remove o áudio do LiveKit
			 * ==========================================
			 */
			const audioTrack = screenShareAudioTrackRef.current;

			if (room && audioTrack) {
				room.localParticipant.unpublishTrack(audioTrack);
			}

			await screenShareAudioRef.current?.stop();

			/**
			 * ==========================================
			 * 5. Limpa refs
			 * ==========================================
			 */
			screenShareCaptureIdRef.current = null;
			screenShareCapturePromiseRef.current = null;

			screenShareTrackRef.current = null;
			screenShareWriterRef.current = null;

			screenShareAudioRef.current = null;
			screenShareAudioTrackRef.current = null;

			setIsScreenSharing(false);
		} catch (error) {
			console.error("Erro ao parar compartilhamento de tela:", error);
		}
	}

	const value: VoiceContextValue = {
		room,
		participants,
		isConnected,
		isScreenSharing,
		isDeafened,
		isMuted,
		voiceChannelId,
		isSomeoneScreenSharing,
		connectionState,
		mute,
		unmute,
		leave,
		deafen,
		undeafen,
		startScreenShare,
		stopScreenShare,
	};

	return (
		<VoiceContext.Provider value={value}>
			{room && <RoomAudioRenderer room={room} />}

			{children}
		</VoiceContext.Provider>
	);
};

export default VoiceProvider;
