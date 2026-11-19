/**
 * Conexão com a sala de voz do LiveKit: entrar, sair, mute e deafen.
 *
 * Falhas (conexão ou microfone) ficam em `error`, para a UI poder mostrar o motivo.
 *
 * Entra com a identidade da sessão: o token vem do `POST /api/voice/token`, com o id do usuário,
 * o nome visível e o nick nos metadados. Quando a sessão deixa de estar conectada (este computador
 * saiu do grupo, por exemplo), a chamada cai sozinha. Quando a API tira a pessoa da sala (removida
 * ou com o computador desvinculado no Painel), confere a sessão na hora.
 *
 * Não sabe nada de captura: cria o `ScreenShareController` da sala e o expõe no contexto. A tela
 * transmitida sai do Rust, numa segunda conexão (`{id}:screen`, ADR 0017).
 * Os componentes leem participantes e trilhas pelos hooks do LiveKit (`useParticipants`,
 * `useTracks`...), que funcionam porque a árvore está dentro do `RoomContext`.
 *
 * A conexão é de um de dois tipos (`kind`): a sala de voz do grupo, ou a ligação privada (ADR 0023),
 * cuja sala tem o nome da conversa. Uma por vez: entrar numa sai da outra. Quem sabe da ligação (a
 * sinalização, quem é a outra pessoa) é a `features/calls`; aqui ela é só uma sala com outro
 * título.
 *
 * Entra sem assinar nada sozinho (`autoSubscribe: false`): a voz de todo mundo é assinada aqui, e a
 * tela transmitida só enquanto aparece, no Foco ou na miniatura (`subscriptions.ts`).
 *
 * O microfone sai com a supressão de ruído do RNNoise (`noise/rnnoise.ts`) quando a opção de
 * Configurações › Voz e vídeo está ligada: ele entra na trilha assim que o microfone é publicado, e
 * entra ou sai na hora quando a opção muda.
 *
 * Entra com o microfone e a saída de Configurações › Voz e vídeo (`deviceChoiceStore.ts`) e troca na hora
 * quando a escolha muda, ou quando o escolhido some e volta (`roomDevices.ts`).
 *
 * A câmera (ADR 0025) sai pela mesma conexão, sempre começando desligada: quem cuida dela é o
 * `useLocalCamera`, e o botão Câmera liga e desliga.
 */
import { RoomContext } from "@livekit/components-react";
import {
	ConnectionState,
	DisconnectReason,
	Room,
	RoomEvent,
	Track,
} from "livekit-client";
import {
	createContext,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "@/components/ui/toast";
import { findChannel, useOptionalChannelLayout } from "@/features/channels";
import { useSession } from "@/features/identity";
import {
	NativeScreenShare,
	type ScreenShareController,
} from "@/features/screen-share";
import {
	type ShownSize,
	stopWatching,
	useRoomView,
} from "../../call/stores/roomViewStore";
import { useShareVolume } from "../../call/stores/shareVolumeStore";
import { useLocalCamera } from "../../camera/hooks/useLocalCamera";
import { useAudioDevices } from "../../devices/hooks/useAudioDevices";
import { effectiveDevice, knownDevices } from "../../devices/model/devices";
import {
	type DeviceIds,
	roomOptions,
	switchDevice,
} from "../../devices/model/roomDevices";
import { useDeviceChoice } from "../../devices/stores/deviceChoiceStore";
import { switchNoiseSuppression } from "../../noise/rnnoise";
import { useNoiseChoice } from "../../noise/stores/noiseStore";
import {
	type SubscriptionView,
	syncSubscription,
	syncSubscriptions,
} from "../model/subscriptions";
import {
	encodeVoiceState,
	parseVoiceState,
	VOICE_STATE_TOPIC,
	withDeafened,
} from "../model/voiceState";
import { useWatchSync } from "../hooks/useWatchSync";
import { fallbackRoomName } from "../model/channel";
import { checkSession, requestVoiceToken } from "../queries";
import { clearVoiceOrder, useVoiceOrder } from "../stores/voiceOrderStore";
import { RoomAudio } from "./RoomAudio";

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

/** Que tipo de conexão de voz: a sala do grupo, ou uma ligação privada. */
export type VoiceKind = "room" | "call";

/** Como entrar: o tipo da conexão e, na ligação, o título (o nome da outra pessoa). */
export interface JoinOptions {
	kind?: VoiceKind;
	title?: string;
}

export interface VoiceContextValue {
	voiceChannelId: string | null;
	/** O tipo da conexão atual; `null` fora de qualquer uma. */
	voiceKind: VoiceKind | null;
	/** Na ligação, com quem é (o nome visível). */
	voiceTitle: string | null;
	/** Só existe depois de conectar. Os componentes da chamada só renderizam com ela. */
	room: Room | null;
	/** Quando a conexão atual entrou (`Date.now()`): o tempo da ligação conta daqui. */
	connectedAt: number | null;
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
	 * a conexão cair. A conexão acontece no efeito do `VoiceProvider`. Sem `options`, é a sala do
	 * grupo.
	 */
	join: (channelId: string, options?: JoinOptions) => void;
	leave: () => void;
}

export const VoiceContext = createContext<VoiceContextValue | null>(null);
const NOBODY: ReadonlySet<string> = new Set();

/** A sala em que a pessoa quer estar; `attempt` muda a cada "tentar de novo" na mesma sala. */
interface VoiceTarget {
	channelId: string;
	attempt: number;
	kind: VoiceKind;
	title: string | null;
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
	const voiceKind = target?.kind ?? null;
	const voiceTitle = target?.title ?? null;

	const [room, setRoom] = useState<Room | null>(null);
	const [connectedAt, setConnectedAt] = useState<number | null>(null);
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
	// O microfone e a saída escolhidos; um que sumiu dá o padrão do Windows (`null`) até voltar.
	const devices = useAudioDevices();
	const chosenInput = useDeviceChoice((state) => state.input);
	const chosenOutput = useDeviceChoice((state) => state.output);
	const inputId = effectiveDevice(chosenInput, knownDevices(devices, "input"));
	const outputId = effectiveDevice(
		chosenOutput,
		knownDevices(devices, "output"),
	);

	/** Os dispositivos de agora, para a conexão ler ao criar a sala. */
	const deviceIds = useRef<DeviceIds>({ input: inputId, output: outputId });
	deviceIds.current = { input: inputId, output: outputId };
	const suppression = useNoiseChoice((state) => state.suppression);
	/** A opção de agora, para os eventos da sala lerem sem recriar a sala. */
	const noise = useRef(suppression);
	noise.current = suppression;

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
		const nextRoom = new Room(roomOptions(deviceIds.current));
		const controller = new NativeScreenShare(channelId);

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
		// Trilha nova de alguém: a voz é assinada; a tela, só se a transmissão dessa pessoa aparece.
		// O microfone publicado (ao entrar, ou ao voltar depois de a trilha ser refeita): põe o RNNoise
		// nele, se a opção está ligada. Não dá para passar o processador nas opções da sala: o LiveKit o
		// aplica antes de a trilha ter o `AudioContext` e recusa.
		nextRoom.on(RoomEvent.LocalTrackPublished, (publication) => {
			if (publication.source === Track.Source.Microphone) {
				void switchNoiseSuppression(nextRoom, noise.current);
			}
		});
		nextRoom.on(RoomEvent.TrackPublished, (publication, participant) => {
			syncSubscription(
				publication,
				participant,
				currentView(),
				nextRoom.localParticipant.identity,
			);
		});

		// Só dispara quando a sala cai sozinha: no cleanup as escutas saem antes do disconnect.
		nextRoom.on(RoomEvent.Disconnected, (reason) => {
			void controller.dispose();
			setRoom(null);
			setScreenShare(null);
			// A sala foi arquivada (a API apaga a sala no LiveKit, ADR 0026): não há para onde voltar.
			if (reason === DisconnectReason.ROOM_DELETED && target.kind === "room") {
				stopWatching();
				setTarget(null);
				toast.add({
					title: "A sala foi arquivada",
					description: "Você saiu da voz.",
				});
				return;
			}
			// A API tirou esta pessoa da sala: confere a sessão já. Se ela saiu do grupo, o 401 leva à
			// tela "saiu do grupo" (pelo `lib/api`), sem esperar a próxima consulta.
			if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
				void checkSession();
			}
		});

		async function connect() {
			try {
				setConnectionState("connecting");
				setError(null);

				const { url, token } = await requestVoiceToken(channelId);
				if (cancelled) return;

				// Nada é assinado sozinho: quem decide é o efeito do `shown`, mais abaixo.
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
				setConnectedAt(Date.now());
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
			setConnectedAt(null);
			setScreenShare(null);
			setConnectionState("disconnected");
			setError(null);
			setDeafenedIds(NOBODY);
		};
	}, [target]);

	// As ordens da API (ADR 0026): alguém pôs esta pessoa em outra sala, ou a tirou da voz. Numa
	// ligação privada não valem (a API nem manda; um evento atrasado é ignorado).
	const order = useVoiceOrder((state) => state.order);
	const layout = useOptionalChannelLayout();
	useEffect(() => {
		if (!order) return;
		clearVoiceOrder();
		if (target?.kind !== "room") return;
		if (order.kind === "move") {
			if (order.channelId === target.channelId) return;
			stopWatching();
			setTarget((current) => ({
				channelId: order.channelId,
				attempt: (current?.attempt ?? 0) + 1,
				kind: "room",
				title: null,
			}));
			setConnectionState("connecting");
			setError(null);
			const name =
				(layout && findChannel(layout, order.channelId)?.name) ??
				fallbackRoomName(order.channelId);
			toast.add({
				title: `${order.byName} moveu você`,
				description: `Agora você está na ${name}.`,
			});
		} else {
			stopWatching();
			setTarget(null);
			toast.add({
				title: "Você foi desconectado da voz",
				description: `Quem desconectou foi ${order.byName}.`,
			});
		}
	}, [order, target, layout]);

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

	// Ao entrar, e a cada troca do que aparece (o palco, a miniatura, os blocos da sala) ou da
	// qualidade escolhida: assina a voz de todos, a tela de quem aparece e as câmeras à vista.
	const shown = useRoomView((state) => state.shown);
	const camerasShown = useRoomView((state) => state.camerasShown);
	const shareSettings = useShareVolume((state) => state.byOwner);
	useEffect(() => {
		if (room) syncSubscriptions(room, currentView());
	}, [room, shown, camerasShown, shareSettings]);

	// Quem assiste o quê (ADR 0024): as transmissões à vista, para a sala, e os avisos dos outros.
	const shownOwners = useMemo(() => Object.keys(shown).sort(), [shown]);
	useWatchSync(room, shownOwners);
	useLocalCamera(room);

	// No meio da chamada, a escolha nova vale na hora, e o escolhido que some ou volta também.
	useEffect(() => {
		if (room) void switchDevice(room, "input", inputId);
	}, [room, inputId]);
	useEffect(() => {
		if (room) void switchDevice(room, "output", outputId);
	}, [room, outputId]);

	useEffect(() => {
		if (room) void switchNoiseSuppression(room, suppression);
	}, [room, suppression]);

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
			voiceKind,
			voiceTitle,
			room,
			connectedAt,
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
			join: (channelId, options) => {
				const retry =
					connectionState === "error" || connectionState === "disconnected";
				if (channelId === voiceChannelId && !retry) return;
				// Trocou de sala (ADR 0026): o que assistia na outra não existe nesta.
				if (voiceChannelId !== null && channelId !== voiceChannelId) {
					stopWatching();
				}
				setTarget((current) => ({
					channelId,
					attempt: (current?.attempt ?? 0) + 1,
					kind: options?.kind ?? "room",
					title: options?.title ?? null,
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
		voiceKind,
		voiceTitle,
		room,
		connectedAt,
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
				{/* O deafen cala só as vozes: a transmissão segue no volume do Foco. */}
				{room && <RoomAudio room={room} deafened={isDeafened} />}
				{children}
			</RoomContext.Provider>
		</VoiceContext.Provider>
	);
}

/**
 * O que aparece agora, para as assinaturas: as transmissões desenhadas (a de qualidade Leve conta
 * como pequena, para pedir a camada leve em qualquer tamanho) e os blocos com as câmeras.
 */
function currentView(): SubscriptionView {
	const { shown, camerasShown } = useRoomView.getState();
	const { byOwner } = useShareVolume.getState();
	const effective: Record<string, ShownSize> = {};
	for (const [owner, size] of Object.entries(shown)) {
		effective[owner] = byOwner[owner]?.quality === "lite" ? "small" : size;
	}
	return { shown: effective, cameras: camerasShown };
}
