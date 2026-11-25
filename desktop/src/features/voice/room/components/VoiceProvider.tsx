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
 * O microfone sai pela cadeia do microfone (`input/chain.ts`, ADR 0029): o volume de entrada, o
 * RNNoise (se ligado) e o portão da detecção de voz e do pressionar para falar. Ela entra na trilha
 * assim que o microfone é publicado, e muda na hora quando uma opção de Voz e vídeo muda.
 *
 * Entra com o microfone e a saída de Configurações › Voz e vídeo (`deviceChoiceStore.ts`) e troca na hora
 * quando a escolha muda, ou quando o escolhido some e volta (`roomDevices.ts`).
 *
 * A câmera (ADR 0025) sai pela mesma conexão, sempre começando desligada: quem cuida dela é o
 * `useLocalCamera`, e o botão Câmera liga e desliga.
 *
 * A voz volta sozinha (ADR 0030): uma queda que a pessoa não pediu (`shouldReconnect`) não limpa a
 * sala; o estado fica `reconnecting` e o app entra de novo, com um token novo, pelo mesmo caminho do
 * "tentar de novo" (`attempt`), esperando cada vez mais (`reconnect.ts`). Depois de 5 minutos,
 * desiste e fica o erro. O mute e o surdo voltam como estavam; a câmera não. O Windows voltando da
 * suspensão conta como queda: entra de novo na hora.
 */
import { RoomContext } from "@livekit/components-react";
import {
	ConnectionState,
	DisconnectReason,
	LogLevel,
	Room,
	RoomEvent,
	setLogLevel,
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
import { ApiError } from "@/lib/api";
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
import {
	setCameraOn,
	useLocalCamera,
} from "../../camera/hooks/useLocalCamera";
import { useAudioDevices } from "../../devices/hooks/useAudioDevices";
import { effectiveDevice, knownDevices } from "../../devices/model/devices";
import {
	type DeviceIds,
	roomOptions,
	switchDevice,
} from "../../devices/model/roomDevices";
import { useDeviceChoice } from "../../devices/stores/deviceChoiceStore";
import { applyInputChain, type ChainOptions } from "../../input/chain";
import { useInputChoice } from "../../input/stores/inputStore";
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
import { useVoiceStatsBroadcast } from "../hooks/useVoiceStatsBroadcast";
import { useWatchSync } from "../hooks/useWatchSync";
import { parseVoiceStats } from "../model/voiceStats";
import {
	clearVoiceStats,
	forgetVoiceStats,
	setVoiceStats,
} from "../stores/voiceStatsStore";
import { fallbackRoomName } from "../model/channel";
import {
	nextAttempt,
	type Recovery,
	shouldReconnect,
} from "../model/reconnect";
import { checkSession, requestVoiceToken } from "../queries";
import { onSystemResumed } from "@/lib/tauri/commands";
import {
	clearModerationNotice,
	setImposed,
	useModeration,
} from "../stores/moderationStore";
import { clearVoiceOrder, useVoiceOrder } from "../stores/voiceOrderStore";
import { RoomAudio } from "./RoomAudio";
import { VoiceStateReport } from "./VoiceStateReport";

// O LiveKit escreve cada passo da conexão no console; só avisos e erros ficam.
setLogLevel(LogLevel.warn);

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
	/**
	 * Silenciada pela moderação (ADR 0034): `isMuted` fica ligado e `unmute` não faz nada até
	 * liberarem. Só nas salas de voz do grupo.
	 */
	serverMuted: boolean;
	/** Com o áudio desligado pela moderação: `isDeafened` fica ligado e `undeafen` não faz nada. */
	serverDeafened: boolean;
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

/**
 * O texto que a pessoa vê quando a voz falha. Um erro da API já vem em português; os do navegador e
 * do LiveKit vêm em inglês e técnicos, então viram uma frase do que fazer (o detalhe fica no log).
 */
function errorMessage(error: unknown): string {
	if (error instanceof ApiError) return error.message;
	return "Não deu para conectar na sala agora. Tente de novo em instantes.";
}

/** Por que o microfone não funcionou, para depois de "Não foi possível usar o microfone: ". */
function microphoneReason(error: unknown): string {
	const name = error instanceof Error ? error.name : "";
	if (name === "NotAllowedError")
		return "o acesso foi negado. Confira a permissão do microfone nas configurações do Windows.";
	if (name === "NotFoundError" || name === "OverconstrainedError")
		return "ele não foi encontrado. Confira se está conectado.";
	if (name === "NotReadableError")
		return "outro programa está usando ele. Feche o programa e tente de novo.";
	return "tente de novo ou escolha outro em Configurações › Voz e vídeo.";
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
	const targetRef = useRef(target);
	targetRef.current = target;

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
	const serverMuted = useModeration((state) => state.serverMuted);
	const serverDeafened = useModeration((state) => state.serverDeafened);
	const [deafenedIds, setDeafenedIds] = useState(NOBODY);

	/**
	 * A queda de agora, enquanto o app tenta voltar sozinho (`null` fora disso), e a próxima
	 * tentativa agendada.
	 */
	const recovery = useRef<Recovery | null>(null);
	/**
	 * A transmissão da sala de agora. Vive enquanto a pessoa fica na mesma sala, e não por conexão:
	 * a `:screen` é uma conexão à parte (ADR 0017), e uma queda da voz não derruba a tela.
	 */
	const shareController = useRef<NativeScreenShare | null>(null);
	const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const reconnect = useRef({
		/** Agenda a próxima tentativa, ou desiste depois de 5 minutos. */
		schedule(now = Date.now()) {
			recovery.current ??= { startedAt: now, tries: 0 };
			const delay = nextAttempt(recovery.current, now);
			reconnect.current.cancel();
			if (delay === null) {
				recovery.current = null;
				void shareController.current?.stop();
				setConnectionState("error");
				setError({
					kind: "connection",
					message: "A conexão com a sala caiu e não voltou.",
				});
				return;
			}
			recovery.current.tries += 1;
			setConnectionState("reconnecting");
			retryTimer.current = setTimeout(() => {
				retryTimer.current = null;
				reconnect.current.now();
			}, delay);
		},
		/** Entra de novo já, com um token novo (a sala de agora sai pelo cleanup do efeito). */
		now() {
			setTarget((current) =>
				current ? { ...current, attempt: current.attempt + 1 } : current,
			);
		},
		cancel() {
			if (retryTimer.current !== null) clearTimeout(retryTimer.current);
			retryTimer.current = null;
		},
		/** A pessoa entrou, saiu ou trocou de sala: a queda anterior não conta mais. */
		reset() {
			reconnect.current.cancel();
			recovery.current = null;
		},
	});
	useEffect(() => () => reconnect.current.cancel(), []);

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
	/** Não há nenhum microfone (com uma lista que serve para dizer): entra mutado, sem tentar. */
	const noMicrophone = useRef(false);
	noMicrophone.current = knownDevices(devices, "input")?.length === 0;
	const inputChoice = useInputChoice();
	const chainOptions = useMemo<ChainOptions>(
		() => ({
			suppression: inputChoice.suppression,
			echoCancellation: inputChoice.echoCancellation,
			autoGainControl: inputChoice.autoGainControl,
			volume: inputChoice.volume,
			mode: inputChoice.mode,
			autoSensitivity: inputChoice.autoSensitivity,
			thresholdDb: inputChoice.thresholdDb,
		}),
		[
			inputChoice.suppression,
			inputChoice.echoCancellation,
			inputChoice.autoGainControl,
			inputChoice.volume,
			inputChoice.mode,
			inputChoice.autoSensitivity,
			inputChoice.thresholdDb,
		],
	);
	/** As opções de agora, para os eventos da sala lerem sem recriar a sala. */
	const chain = useRef(chainOptions);
	chain.current = chainOptions;

	// Sem sessão não há chamada: saiu do grupo, o token da API já não vale.
	const sessionConnected = useSession().status === "connected";
	useEffect(() => {
		if (!sessionConnected) {
			reconnect.current.reset();
			setTarget(null);
		}
	}, [sessionConnected]);

	// O Windows voltou da suspensão: a conexão de antes morreu, mesmo que o LiveKit ainda não saiba.
	useEffect(
		() =>
			onSystemResumed(() => {
				if (!targetRef.current) return;
				recovery.current ??= { startedAt: Date.now(), tries: 0 };
				reconnect.current.cancel();
				setConnectionState("reconnecting");
				reconnect.current.now();
			}),
		[],
	);

	// Antes do efeito da conexão, para ele já encontrar a transmissão desta sala.
	const shareChannel = target?.channelId ?? null;
	useEffect(() => {
		if (shareChannel === null) return;
		const controller = new NativeScreenShare(shareChannel);
		shareController.current = controller;
		return () => {
			if (shareController.current === controller) shareController.current = null;
			void controller.dispose();
		};
	}, [shareChannel]);

	useEffect(() => {
		const controller = shareController.current;
		if (!target || !controller) {
			return;
		}

		const { channelId } = target;
		let cancelled = false;
		const nextRoom = new Room(roomOptions(deviceIds.current));

		nextRoom.on(RoomEvent.ConnectionStateChanged, (state) => {
			// Voltando de uma queda, o "conectando" e o "desconectado" no meio são o "reconectando".
			const next = toVoiceState(state);
			setConnectionState(
				recovery.current && next !== "connected" ? "reconnecting" : next,
			);
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
					return;
				}
				// Os números da conexão de quem mandou (`voiceStats.ts`), a cada 5 segundos.
				const stats = parseVoiceStats(payload);
				if (stats) setVoiceStats(participant.identity, stats);
			},
		);
		nextRoom.on(RoomEvent.ParticipantDisconnected, (participant) => {
			setDeafenedIds((current) =>
				withDeafened(current, participant.identity, false),
			);
			forgetVoiceStats(participant.identity);
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
		// O microfone publicado (ao entrar, ou ao voltar depois de a trilha ser refeita): põe a cadeia
		// do microfone nele (volume, RNNoise e portão, ADR 0029). Não dá para passar o processador nas
		// opções da sala: o LiveKit o aplica antes de a trilha ter o `AudioContext` e recusa.
		nextRoom.on(RoomEvent.LocalTrackPublished, (publication) => {
			if (publication.source === Track.Source.Microphone) {
				void applyInputChain(nextRoom, chain.current);
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
			setRoom(null);
			setScreenShare(null);
			// A sala foi arquivada (a API apaga a sala no LiveKit, ADR 0026): não há para onde voltar.
			if (reason === DisconnectReason.ROOM_DELETED && target.kind === "room") {
				stopWatching();
				setTarget(null);
				toast.add({
					title: "A sala foi arquivada",
					description: "Você saiu da voz.",
					data: { tone: "info" },
				});
				return;
			}
			// A API tirou esta pessoa da sala: confere a sessão já. Se ela saiu do grupo, o 401 leva à
			// tela "saiu do grupo" (pelo `lib/api`), sem esperar a próxima consulta.
			if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
				void checkSession();
			}
			// Caiu sem ninguém pedir: tenta voltar sozinha. Tirada ou com a sala fechada, não volta.
			if (shouldReconnect(reason)) {
				console.warn("A voz caiu; tentando voltar:", reason);
				reconnect.current.schedule();
			} else {
				// A transmissão continua numa queda que volta; aqui a pessoa não volta mais.
				void controller.stop();
				reconnect.current.reset();
			}
		});

		async function connect() {
			try {
				setConnectionState(recovery.current ? "reconnecting" : "connecting");
				setError(null);

				const { url, token, server_muted, server_deafened } =
					await requestVoiceToken(channelId);
				if (cancelled) return;
				// A moderação vale desde a entrada: o token já não deixa abrir o microfone.
				setImposed(server_muted, server_deafened);

				// Nada é assinado sozinho: quem decide é o efeito do `shown`, mais abaixo.
				await nextRoom.connect(url, token, { autoSubscribe: false });
				if (cancelled) return;

				// O microfone não é obrigatório para entrar: sem permissão ou sem dispositivo, a pessoa
				// continua ouvindo e pode compartilhar a tela, só que entra mutada, com o motivo em `error`.
				// Se isto lançasse para fora, a sala ficaria conectada sem nenhuma UI para sair dela.
				// Quem mutou (ou fez deafen) antes de entrar entra assim, sem abrir o microfone.
				let microphoneProblem: string | null = null;
				const wasMuted = audioFlags.current.isMuted || server_muted;
				const wasDeafened = audioFlags.current.isDeafened || server_deafened;
				if (!wasMuted && !wasDeafened && noMicrophone.current) {
					microphoneProblem = "Nenhum microfone encontrado.";
				} else if (!wasMuted && !wasDeafened) {
					try {
						await nextRoom.localParticipant.setMicrophoneEnabled(true);
					} catch (microphoneError) {
						console.warn(
							"Não foi possível ativar o microfone:",
							microphoneError,
						);
						microphoneProblem = `Não foi possível usar o microfone: ${microphoneReason(microphoneError)}`;
					}
				}
				if (cancelled) return;

				if (recovery.current) {
					console.info("A voz voltou depois de", recovery.current.tries, "tentativas");
				}
				recovery.current = null;
				setRoom(nextRoom);
				setConnectedAt(Date.now());
				setScreenShare(controller);
				if (microphoneProblem !== null) setIsMuted(true);
				setError(
					microphoneProblem === null
						? null
						: {
								kind: "microphone",
								message: microphoneProblem,
							},
				);
			} catch (connectError) {
				// Voltando de uma queda, a tentativa que falhou (a API ou o LiveKit fora) agenda a próxima.
				if (!cancelled && recovery.current) {
					console.warn("A tentativa de voltar para a voz falhou:", connectError);
					reconnect.current.schedule();
					return;
				}
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

			// A transmissão não para aqui: entre uma tentativa e outra, ela continua (e sai com a sala,
			// pelo efeito dela).
			void nextRoom.disconnect();

			setRoom(null);
			setConnectedAt(null);
			setScreenShare(null);
			setConnectionState(recovery.current ? "reconnecting" : "disconnected");
			setError(null);
			setDeafenedIds(NOBODY);
			clearVoiceStats();
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
			reconnect.current.reset();
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
				data: { tone: "info" },
			});
		} else {
			reconnect.current.reset();
			stopWatching();
			setTarget(null);
			toast.add(
				order.noAccess
					? {
							title: "Você não tem mais acesso a esta sala",
							description: `${order.byName} mudou quem tem acesso.`,
							data: { tone: "warning" },
						}
					: {
							title: "Você foi desconectado da voz",
							description: `Quem desconectou foi ${order.byName}.`,
							data: { tone: "warning" },
						},
			);
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
	const focusedCamera = useRoomView((state) => state.focusedCamera);
	const shareSettings = useShareVolume((state) => state.byOwner);
	useEffect(() => {
		if (room) syncSubscriptions(room, currentView());
	}, [room, shown, camerasShown, focusedCamera, shareSettings]);

	// Quem assiste o quê (ADR 0024): as transmissões à vista, para a sala, e os avisos dos outros.
	const shownOwners = useMemo(() => Object.keys(shown).sort(), [shown]);
	useWatchSync(room, shownOwners);
	useVoiceStatsBroadcast(room);
	useLocalCamera(room);

	// No meio da chamada, a escolha nova vale na hora, e o escolhido que some ou volta também.
	useEffect(() => {
		if (room) void switchDevice(room, "input", inputId);
	}, [room, inputId]);
	useEffect(() => {
		if (room) void switchDevice(room, "output", outputId);
	}, [room, outputId]);

	useEffect(() => {
		if (room) void applyInputChain(room, chainOptions);
	}, [room, chainOptions]);

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
					message: `Não foi possível ${enabled ? "ativar" : "desativar"} o microfone: ${microphoneReason(microphoneError)}`,
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
			serverMuted,
			serverDeafened,
			deafenedIds,
			mute: () => setMicrophone(false),
			unmute: async () => {
				// Silenciada pela moderação: o clique, o atalho e o Pressionar para falar não abrem.
				if (useModeration.getState().serverMuted) return;
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
				if (useModeration.getState().serverDeafened) return;
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
				reconnect.current.reset();
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
			leave: () => {
				reconnect.current.reset();
				setTarget(null);
			},
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
		serverMuted,
		serverDeafened,
		deafenedIds,
	]);

	// A moderação (ADR 0034): silenciada, muta e marca que foi ela; liberada, volta como a pessoa
	// estava. O mesmo para o áudio. O LiveKit já garante; isto acerta o estado e os botões.
	const valueRef = useRef(value);
	valueRef.current = value;
	const mutedByModeration = useRef(false);
	const deafenedByModeration = useRef(false);
	useEffect(() => {
		const voice = valueRef.current;
		if (serverMuted && !voice.isMuted) {
			mutedByModeration.current = true;
			void voice.mute();
		} else if (!serverMuted && mutedByModeration.current) {
			mutedByModeration.current = false;
			if (!voice.isDeafened) void voice.unmute();
		}
	}, [serverMuted]);
	useEffect(() => {
		const voice = valueRef.current;
		if (serverDeafened && !voice.isDeafened) {
			deafenedByModeration.current = true;
			void voice.deafen();
		} else if (!serverDeafened && deafenedByModeration.current) {
			deafenedByModeration.current = false;
			void voice.undeafen();
		}
	}, [serverDeafened]);

	// Desligar a câmera e encerrar a transmissão (ADR 0034): de uma vez só, com o aviso. Parar
	// por aqui, antes de a API derrubar a tela, evita a volta automática de uma queda.
	const moderationNotice = useModeration((state) => state.notice);
	useEffect(() => {
		if (!moderationNotice) return;
		clearModerationNotice();
		if (target?.kind !== "room") return;
		if (moderationNotice.action === "camera_off") {
			if (room) void setCameraOn(room, false);
			toast.add({
				title: `${moderationNotice.byName} desligou sua câmera`,
				description: "Você pode ligar de novo pelo botão Câmera.",
				data: { tone: "warning" },
			});
		} else {
			void screenShare?.stop();
			toast.add({
				title: `${moderationNotice.byName} encerrou sua transmissão`,
				description: "Você pode transmitir de novo pelo botão Tela.",
				data: { tone: "warning" },
			});
		}
	}, [moderationNotice, target, room, screenShare]);

	return (
		<VoiceContext.Provider value={value}>
			<RoomContext.Provider value={room ?? undefined}>
				{/* muted também cancela a assinatura: quem entrar depois do deafen não é ouvido. */}
				{/* O deafen cala só as vozes: a transmissão segue no volume do Foco. */}
				{room && <RoomAudio room={room} deafened={isDeafened} />}
				{room && voiceKind === "room" && voiceChannelId && (
					<VoiceStateReport
						channelId={voiceChannelId}
						screenShare={screenShare}
					/>
				)}
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
	const { shown, camerasShown, focusedCamera } = useRoomView.getState();
	const { byOwner } = useShareVolume.getState();
	const effective: Record<string, ShownSize> = {};
	for (const [owner, size] of Object.entries(shown)) {
		effective[owner] = byOwner[owner]?.quality === "lite" ? "small" : size;
	}
	return { shown: effective, cameras: camerasShown, bigCamera: focusedCamera };
}
