/**
 * Conexão com a sala de voz do LiveKit: entrar, sair, mute e deafen.
 *
 * Falhas (conexão ou microfone) ficam em `error`, para a UI poder mostrar o motivo.
 *
 * Não sabe nada de captura: cria o `ScreenShareController` da sala e o expõe no contexto.
 * Os componentes leem participantes e trilhas pelos hooks do LiveKit (`useParticipants`,
 * `useTracks`...), que funcionam porque a árvore está dentro do `RoomContext`.
 */
import { RoomAudioRenderer, RoomContext } from "@livekit/components-react";
import { ConnectionState, Room, RoomEvent } from "livekit-client";
import {
	createContext,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ScreenShareController } from "@/features/screen-share/controller";
import { IpcScreenShare } from "@/features/screen-share/ipc/IpcScreenShare";
import { apiUrl } from "@/lib/config";
import { useNavigationStore } from "@/stores/navigation";

export type VoiceConnectionState =
	| "disconnected"
	| "connecting"
	| "connected"
	| "reconnecting"
	| "error";

/**
 * Último problema da voz. `connection`: não deu para entrar (junto de `connectionState` "error").
 * `microphone`: a pessoa está na sala, mas o microfone não funcionou.
 */
export interface VoiceError {
	kind: "connection" | "microphone";
	message: string;
}

export interface VoiceContextValue {
	voiceChannelId: string | null;
	/** Só existe depois de conectar. Os componentes da chamada só renderizam com ela. */
	room: Room | null;
	connectionState: VoiceConnectionState;
	error: VoiceError | null;
	screenShare: ScreenShareController | null;
	isMuted: boolean;
	isDeafened: boolean;
	mute: () => Promise<void>;
	unmute: () => Promise<void>;
	deafen: () => Promise<void>;
	undeafen: () => Promise<void>;
	leave: () => void;
}

export const VoiceContext = createContext<VoiceContextValue | null>(null);

async function requestVoiceToken(channelId: string) {
	const random = crypto.randomUUID();

	const res = await fetch(apiUrl("/api/voice/join"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			channel_id: channelId,
			user_id: `idiot-${random}`,
			display_name: `Idiota-${random}`,
		}),
	});

	if (!res.ok) {
		throw new Error("Não foi possível entrar no canal de voz.");
	}

	return (await res.json()) as { token: string; url: string };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function toVoiceState(state: ConnectionState): VoiceConnectionState {
	switch (state) {
		case ConnectionState.Connecting:
			return "connecting";
		case ConnectionState.Connected:
			return "connected";
		case ConnectionState.Reconnecting:
		case ConnectionState.SignalReconnecting:
			return "reconnecting";
		case ConnectionState.Disconnected:
			return "disconnected";
	}
}

export function VoiceProvider({ children }: { children: ReactNode }) {
	const voiceChannelId = useNavigationStore((state) => state.voiceChannelId);
	const leaveVoiceChannel = useNavigationStore(
		(state) => state.leaveVoiceChannel,
	);

	const [room, setRoom] = useState<Room | null>(null);
	const [screenShare, setScreenShare] = useState<ScreenShareController | null>(
		null,
	);
	const [connectionState, setConnectionState] =
		useState<VoiceConnectionState>("disconnected");
	const [error, setError] = useState<VoiceError | null>(null);
	const [isMuted, setIsMuted] = useState(false);
	const [isDeafened, setIsDeafened] = useState(false);

	/** Se o microfone já estava mutado quando o deafen começou. */
	const mutedBeforeDeafen = useRef(false);

	useEffect(() => {
		if (!voiceChannelId) {
			return;
		}

		const channelId = voiceChannelId;
		let cancelled = false;
		const nextRoom = new Room();
		const controller = new IpcScreenShare(nextRoom);

		nextRoom.on(RoomEvent.ConnectionStateChanged, (state) => {
			setConnectionState(toVoiceState(state));
		});

		// Só dispara quando a sala cai sozinha: no cleanup as escutas saem antes do disconnect.
		nextRoom.on(RoomEvent.Disconnected, () => {
			void controller.dispose();
			setRoom(null);
			setScreenShare(null);
		});

		async function connect() {
			try {
				setConnectionState("connecting");
				setError(null);

				const { url, token } = await requestVoiceToken(channelId);
				if (cancelled) return;

				await nextRoom.connect(url, token);
				if (cancelled) return;

				// O microfone não é obrigatório para entrar: sem permissão ou sem dispositivo, a pessoa
				// continua ouvindo e pode compartilhar a tela, só que entra mutada, com o motivo em `error`.
				// Se isto lançasse para fora, a sala ficaria conectada sem nenhuma UI para sair dela.
				let microphoneProblem: string | null = null;
				try {
					await nextRoom.localParticipant.setMicrophoneEnabled(true);
				} catch (microphoneError) {
					console.warn("Não foi possível ativar o microfone:", microphoneError);
					microphoneProblem = errorMessage(microphoneError);
				}
				if (cancelled) return;

				setRoom(nextRoom);
				setScreenShare(controller);
				setIsMuted(microphoneProblem !== null);
				setIsDeafened(false);
				setError(
					microphoneProblem === null
						? null
						: {
								kind: "microphone",
								message: `Não foi possível usar o microfone: ${microphoneProblem}`,
							},
				);
			} catch (connectError) {
				if (!cancelled) {
					console.error("Erro ao conectar na voz:", connectError);
					setError({ kind: "connection", message: errorMessage(connectError) });
					setConnectionState("error");
				}
			}
		}

		void connect();

		return () => {
			cancelled = true;
			nextRoom.removeAllListeners();

			// Para o compartilhamento (e a captura no Rust) antes de sair da sala.
			void controller.dispose().finally(() => nextRoom.disconnect());

			setRoom(null);
			setScreenShare(null);
			setConnectionState("disconnected");
			setError(null);
		};
	}, [voiceChannelId]);

	const value = useMemo<VoiceContextValue>(() => {
		async function setMicrophone(enabled: boolean) {
			if (!room) return;

			try {
				await room.localParticipant.setMicrophoneEnabled(enabled);
			} catch (microphoneError) {
				console.warn("Erro ao trocar o estado do microfone:", microphoneError);
				setError({
					kind: "microphone",
					message: `Não foi possível ${enabled ? "ativar" : "desativar"} o microfone: ${errorMessage(microphoneError)}`,
				});
				return;
			}

			setIsMuted(!enabled);
			// Uma troca que deu certo resolve um problema de microfone anterior.
			setError((current) => (current?.kind === "microphone" ? null : current));
		}

		return {
			voiceChannelId,
			room,
			connectionState,
			error,
			screenShare,
			isMuted,
			isDeafened,
			mute: () => setMicrophone(false),
			unmute: async () => {
				// O deafen muta o microfone sozinho, então a pessoa vê "mutado" e clica para desmutar:
				// como no Discord, isso também tira o deafen. Sem tirá-lo, o microfone ficaria aberto
				// com o áudio da sala ainda desligado.
				if (isDeafened) setIsDeafened(false);
				await setMicrophone(true);
			},
			deafen: async () => {
				// Um segundo deafen gravaria "mutado" (efeito do primeiro) como o estado anterior.
				if (isDeafened) return;
				mutedBeforeDeafen.current = isMuted;
				setIsDeafened(true);
				await setMicrophone(false);
			},
			undeafen: async () => {
				// Sem o deafen ativo, reativar o microfone desfaria um mute que a pessoa pediu.
				if (!isDeafened) return;
				setIsDeafened(false);
				if (!mutedBeforeDeafen.current) {
					await setMicrophone(true);
				}
			},
			// O cleanup do efeito cuida do resto quando o voiceChannelId vira null.
			leave: leaveVoiceChannel,
		};
	}, [
		voiceChannelId,
		room,
		connectionState,
		error,
		screenShare,
		isMuted,
		isDeafened,
		leaveVoiceChannel,
	]);

	return (
		<VoiceContext.Provider value={value}>
			<RoomContext.Provider value={room ?? undefined}>
				{/* muted também cancela a assinatura: quem entrar depois do deafen não é ouvido. */}
				{room && <RoomAudioRenderer muted={isDeafened} />}
				{children}
			</RoomContext.Provider>
		</VoiceContext.Provider>
	);
}
