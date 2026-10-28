/**
 * Conexão com a sala de voz do LiveKit: entrar, sair, mute e deafen.
 *
 * Falhas (conexão ou microfone) ficam em `error`, para a UI poder mostrar o motivo.
 *
 * Entra com a identidade da sessão: o token vem do `POST /api/voice/token`, com o id do usuário,
 * o nome visível e o nick nos metadados. Quando a sessão deixa de estar conectada (este computador
 * saiu do grupo, por exemplo), a chamada cai sozinha.
 *
 * Não sabe nada de captura: cria o `ScreenShareController` da sala e o expõe no contexto.
 * Os componentes leem participantes e trilhas pelos hooks do LiveKit (`useParticipants`,
 * `useTracks`...), que funcionam porque a árvore está dentro do `RoomContext`.
 *
 * Entra sem assinar nada sozinho (`autoSubscribe: false`): a voz de todo mundo é assinada aqui, e a
 * tela transmitida só enquanto aparece no Foco (`subscriptions.ts`).
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
import { useSession } from "@/features/identity";
import {
	IpcScreenShare,
	type ScreenShareController,
} from "@/features/screen-share";
import { createVoiceToken } from "@/lib/api";
import { useRoomView } from "./roomView";
import { syncSubscription, syncSubscriptions } from "./subscriptions";
import {
	encodeVoiceState,
	parseVoiceState,
	VOICE_STATE_TOPIC,
	withDeafened,
} from "./voiceState";

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
	/** Mute e deafen valem também fora da chamada: a próxima entrada já começa assim. */
	isMuted: boolean;
	isDeafened: boolean;
	/** Quem mais na sala desligou o áudio, pelos avisos dos outros apps (`voiceState.ts`). */
	deafenedIds: ReadonlySet<string>;
	mute: () => Promise<void>;
	unmute: () => Promise<void>;
	deafen: () => Promise<void>;
	undeafen: () => Promise<void>;
	/**
	 * Entra na sala (ou troca de sala). Na mesma sala, só tenta de novo depois de um erro ou de
	 * a conexão cair. A conexão acontece no efeito do `VoiceProvider`.
	 */
	join: (channelId: string) => void;
	leave: () => void;
}

export const VoiceContext = createContext<VoiceContextValue | null>(null);
const NOBODY: ReadonlySet<string> = new Set();

/** A sala em que a pessoa quer estar; `attempt` muda a cada "tentar de novo" na mesma sala. */
interface VoiceTarget {
	channelId: string;
	attempt: number;
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
	/** Sala em que a pessoa quer estar. Mudou, o efeito abaixo sai da anterior e entra na nova. */
	const [target, setTarget] = useState<VoiceTarget | null>(null);
	const voiceChannelId = target?.channelId ?? null;

	const [room, setRoom] = useState<Room | null>(null);
	const [screenShare, setScreenShare] = useState<ScreenShareController | null>(
		null,
	);
	const [connectionState, setConnectionState] =
		useState<VoiceConnectionState>("disconnected");
	const [error, setError] = useState<VoiceError | null>(null);
	const [isMuted, setIsMuted] = useState(false);
	const [isDeafened, setIsDeafened] = useState(false);
	const [deafenedIds, setDeafenedIds] = useState(NOBODY);

	/** Se o microfone já estava mutado quando o deafen começou. */
	const mutedBeforeDeafen = useRef(false);

	/** Mute e deafen de agora, para a conexão ler sem depender deles. */
	const audioFlags = useRef({ isMuted, isDeafened });
	audioFlags.current = { isMuted, isDeafened };

	// Sem sessão não há chamada: saiu do grupo, o token da API já não vale.
	const sessionConnected = useSession().status === "connected";
	useEffect(() => {
		if (!sessionConnected) setTarget(null);
	}, [sessionConnected]);

	useEffect(() => {
		if (!target) {
			return;
		}

		const { channelId } = target;
		let cancelled = false;
		const nextRoom = new Room();
		const controller = new IpcScreenShare(nextRoom);

		nextRoom.on(RoomEvent.ConnectionStateChanged, (state) => {
			setConnectionState(toVoiceState(state));
		});

		nextRoom.on(
			RoomEvent.DataReceived,
			(payload, participant, _kind, topic) => {
				if (topic !== VOICE_STATE_TOPIC || !participant) return;
				const state = parseVoiceState(payload);
				if (state) {
					setDeafenedIds((current) =>
						withDeafened(current, participant.identity, state.deafened),
					);
				}
			},
		);
		nextRoom.on(RoomEvent.ParticipantDisconnected, (participant) => {
			setDeafenedIds((current) =>
				withDeafened(current, participant.identity, false),
			);
		});
		// Quem entra depois não recebeu o aviso: repete só para essa pessoa.
		nextRoom.on(RoomEvent.ParticipantConnected, (participant) => {
			if (!audioFlags.current.isDeafened) return;
			void nextRoom.localParticipant
				.publishData(encodeVoiceState({ deafened: true }), {
					reliable: true,
					topic: VOICE_STATE_TOPIC,
					destinationIdentities: [participant.identity],
				})
				.catch((sendError: unknown) =>
					console.warn("Erro ao avisar o deafen:", sendError),
				);
		});
		// Trilha nova de alguém: a voz é assinada; a tela, só se essa pessoa está no palco do Foco.
		nextRoom.on(RoomEvent.TrackPublished, (publication, participant) => {
			syncSubscription(
				publication,
				participant,
				useRoomView.getState().onStage,
			);
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

				const { url, token } = await createVoiceToken(channelId);
				if (cancelled) return;

				// Nada é assinado sozinho: quem decide é o efeito do `onStage`, mais abaixo.
				await nextRoom.connect(url, token, { autoSubscribe: false });
				if (cancelled) return;

				// O microfone não é obrigatório para entrar: sem permissão ou sem dispositivo, a pessoa
				// continua ouvindo e pode compartilhar a tela, só que entra mutada, com o motivo em `error`.
				// Se isto lançasse para fora, a sala ficaria conectada sem nenhuma UI para sair dela.
				// Quem mutou (ou fez deafen) antes de entrar entra assim, sem abrir o microfone.
				let microphoneProblem: string | null = null;
				const { isMuted: wasMuted, isDeafened: wasDeafened } =
					audioFlags.current;
				if (!wasMuted && !wasDeafened) {
					try {
						await nextRoom.localParticipant.setMicrophoneEnabled(true);
					} catch (microphoneError) {
						console.warn(
							"Não foi possível ativar o microfone:",
							microphoneError,
						);
						microphoneProblem = errorMessage(microphoneError);
					}
				}
				if (cancelled) return;

				setRoom(nextRoom);
				setScreenShare(controller);
				if (microphoneProblem !== null) setIsMuted(true);
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
			setDeafenedIds(NOBODY);
		};
	}, [target]);

	// Avisa os outros apps a cada troca do deafen (e ao entrar, para começar do estado certo).
	useEffect(() => {
		if (!room) return;
		void room.localParticipant
			.publishData(encodeVoiceState({ deafened: isDeafened }), {
				reliable: true,
				topic: VOICE_STATE_TOPIC,
			})
			.catch((sendError: unknown) =>
				console.warn("Erro ao avisar o deafen:", sendError),
			);
	}, [room, isDeafened]);

	// Ao entrar, e a cada troca do palco do Foco: assina a voz de todos e a tela de quem está nele.
	const onStage = useRoomView((state) => state.onStage);
	useEffect(() => {
		if (room) syncSubscriptions(room, onStage);
	}, [room, onStage]);

	const value = useMemo<VoiceContextValue>(() => {
		async function setMicrophone(enabled: boolean) {
			// Fora da chamada, só guarda a escolha: a conexão lê na próxima entrada.
			if (!room) {
				setIsMuted(!enabled);
				return;
			}

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
			deafenedIds,
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
			join: (channelId) => {
				const retry =
					connectionState === "error" || connectionState === "disconnected";
				if (channelId === voiceChannelId && !retry) return;
				setTarget((current) => ({
					channelId,
					attempt: (current?.attempt ?? 0) + 1,
				}));
				// Já como "conectando", para a tela não piscar um estado parado até o efeito rodar.
				setConnectionState("connecting");
				setError(null);
			},
			// O cleanup do efeito cuida do resto quando a sala vira null.
			leave: () => setTarget(null),
		};
	}, [
		voiceChannelId,
		room,
		connectionState,
		error,
		screenShare,
		isMuted,
		isDeafened,
		deafenedIds,
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
