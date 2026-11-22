import type { TrackReference } from "@livekit/components-react";
import { type ReactNode, useEffect, useState } from "react";
import { Minimize2Icon } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { useMe, useSession } from "@/features/identity";
import { QuickInvite } from "@/features/invites";
import {
	openSharePanel,
	parseShareTrackName,
	type ScreenShareController,
	shareSpec,
	sourceRefKey,
	useScreenShareState,
	useScreenShares,
	useThumbnails,
} from "@/features/screen-share";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";
import type { CaptureSource } from "@/lib/tauri/commands";
import {
	setWindowFullscreen,
	watchWindowFullscreen,
} from "@/lib/tauri/window";
import {
	CameraVideo,
	cameraTrackOf,
} from "../../camera/components/CameraVideo";
import { useCameraChoice } from "../../camera/stores/cameraChoiceStore";
import {
	ConnectingTile,
	ParticipantTile,
} from "../../members/components/ParticipantTile";
import {
	type LiveMember,
	useLiveMembers,
} from "../../members/hooks/useLiveMembers";
import { useShareQuality } from "../../room/hooks/useShareQuality";
import { useVoice } from "../../room/hooks/useVoice";
import { stageLayout } from "../model/stageLayout";
import {
	focusCamera,
	focusShare,
	setCamerasShown,
	stopWatching,
	unwatchShare,
	useRoomView,
	watchShare,
} from "../stores/roomViewStore";
import { CallControls } from "./CallControls";
import { CALL_TILE_MAX, RoomGrid } from "./RoomGrid";
import { LayoutToggle, RoomHeader } from "./RoomHeader";
import { LiveBadge } from "./LiveBadge";
import { ScreenStage, SmallShare } from "./ScreenStage";
import { ShareTile } from "./ShareTile";

/*
 * A sala de voz por dentro. Grade e Foco mostram as mesmas trilhas: a Grade, todo mundo e o lugar
 * de cada transmissão; o Foco (o palco), as transmissões que a pessoa abriu, arrumadas pelo
 * `stageLayout` (uma, lado a lado, 2×2, ou uma em foco com as outras pequenas), com quem está na
 * chamada numa faixa embaixo (a tela cheia leva os dois juntos). Uma câmera também vai para o
 * palco (v0.7): sozinha e grande, com as transmissões abertas e o resto da chamada na faixa. Várias pessoas transmitem ao mesmo
 * tempo (ADR 0024). A chamada mora no `VoiceProvider`, acima do
 * router: sair desta tela não sai da sala.
 *
 * A ligação privada (ADR 0023, Etapa 21 da v0.3) usa esta mesma tela: o cabeçalho vira "Ligação
 * com fulano · Privada" e o tempo, os dois lugares ficam maiores, o Convidar some e o Sair é o
 * Desligar. Quem encerra a ligação na API é a `features/calls`, ao ver a voz sair da sala dela.
 */
export function VoiceRoom() {
	const {
		voiceChannelId,
		voiceKind,
		voiceTitle,
		room,
		connectionState,
		error,
		join,
		leave,
		screenShare,
	} = useVoice();
	const navigate = useNavigate();
	const call = voiceKind === "call" ? { title: voiceTitle ?? "" } : undefined;

	if (!voiceChannelId) {
		return <Navigate to={paths.server} replace />;
	}

	function exit() {
		void navigate(paths.server, { replace: true });
		leave();
		stopWatching();
	}

	if (room) {
		return <ConnectedRoom onExit={exit} call={call} />;
	}

	const failed =
		connectionState === "error" || connectionState === "disconnected";
	return (
		<RoomFrame
			header={<RoomHeader call={call} />}
			controls={
				<CallControls
					controller={screenShare}
					onExit={exit}
					call={call !== undefined}
				/>
			}
		>
			{failed ? (
				<ErrorState
					title={
						connectionState === "error"
							? call
								? "Não foi possível entrar na ligação"
								: "Não foi possível entrar na sala"
							: call
								? "A conexão com a ligação caiu"
								: "A conexão com a sala caiu"
					}
					description={
						error?.message ?? "Tente de novo. Se continuar, avise o dono."
					}
					onRetry={() =>
						join(voiceChannelId, call ? { kind: "call", ...call } : undefined)
					}
				/>
			) : (
				<MeConnecting />
			)}
		</RoomFrame>
	);
}

function RoomFrame({
	header,
	controls,
	children,
}: {
	header: ReactNode;
	controls: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			{header}
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
				{children}
			</div>
			{controls}
		</div>
	);
}

/** O próprio lugar, tracejado, enquanto a conexão não termina. */
function MeConnecting() {
	const session = useSession();
	const { data: me } = useMe();
	const user =
		me?.user ?? (session.status === "connected" ? session.user : null);
	return (
		<div className="flex flex-1 items-center justify-center p-6">
			{user && (
				<ConnectingTile
					nick={user.nick}
					name={user.display_name?.trim() || user.nick}
				/>
			)}
		</div>
	);
}

function ConnectedRoom({
	onExit,
	call,
}: {
	onExit: () => void;
	call?: { title: string };
}) {
	const { screenShare, connectedAt } = useVoice();
	const connectedFor = useConnectedClock(connectedAt);
	const { data: me } = useMe();

	const members = useLiveMembers();
	const shareState = useScreenShareState(screenShare);
	// Todas as transmissões da sala, assinadas ou não, da mais antiga para a mais nova (ADR 0024).
	const remotes = useScreenShares().filter((share) => !share.isOwn);
	const memberOf = (identity: string) =>
		members.find((member) => member.id === identity);

	const watching = useRoomView((state) => state.watching);
	const focused = useRoomView((state) => state.focused);
	// As abertas que estão no ar, na ordem em que a pessoa abriu.
	const open = watching.filter((id) =>
		remotes.some((share) => share.ownerId === id && memberOf(id)),
	);
	const layout = stageLayout(open, focused);
	const focusedCamera = useRoomView((state) => state.focusedCamera);
	// A câmera em foco, enquanto está ligada.
	const camMember = members.find(
		(member) =>
			member.id === focusedCamera && cameraTrackOf(member.participant) !== null,
	);
	const stage = open.length > 0 || camMember !== undefined;
	// A câmera desligou (ou a pessoa saiu): o foco dela sai junto, e a sala volta ao que era.
	useEffect(() => {
		if (focusedCamera && !camMember) focusCamera(null);
	}, [focusedCamera, camMember]);
	// As que estão no ar e a pessoa não abriu: aparecem com Assistir embaixo do palco.
	const notOpen = remotes.filter(
		(share) => !open.includes(share.ownerId) && memberOf(share.ownerId),
	);

	// Os blocos da sala à vista: as câmeras são baixadas, grandes na Grade e pequenas no palco.
	useEffect(() => {
		setCamerasShown(stage ? "small" : "full");
		return () => setCamerasShown(false);
	}, [stage]);

	// O palco inteiro (as transmissões e a faixa de quem está na chamada) vai para a tela cheia.
	const fullscreen = useFullscreen();
	const idle = useIdle(fullscreen.active);

	const firstOpen = open[0] ? memberOf(open[0]) : undefined;
	const subtitle = camMember
		? `Câmera de ${camMember.name}`
		: stage
			? open.length === 1 && firstOpen
				? `Assistindo ${firstOpen.name}`
				: `Assistindo ${open.length} transmissões`
			: call
				? clockLabel(connectedFor)
				: `${members.length} ${members.length === 1 ? "participante" : "participantes"}`;
	const withCamera = members.filter(
		(member) => cameraTrackOf(member.participant) !== null,
	);

	const shareOf = (id: string) => remotes.find((share) => share.ownerId === id);

	return (
		<RoomFrame
			header={
				<RoomHeader
					subtitle={subtitle}
					call={call}
					actions={
						<>
							{!call && me?.can_create_invite && (
								<QuickInvite canViewPanel={me.can_view_panel} />
							)}
							<LayoutToggle
								focus={stage}
								focusAvailable={remotes.length > 0 || withCamera.length > 0}
								onGrid={stopWatching}
								onFocus={() => {
									const first = remotes[0];
									if (first) watchShare(first.ownerId);
									else if (withCamera[0]) focusCamera(withCamera[0].id);
								}}
							/>
						</>
					}
				/>
			}
			controls={
				<CallControls
					controller={screenShare}
					onExit={onExit}
					call={call !== undefined}
				/>
			}
		>
			{stage ? (
				<div
					data-idle={idle || undefined}
					className={cn(
						"flex min-h-0 flex-1 flex-col items-center gap-4 px-6 pt-5 pb-4",
						fullscreen.active &&
							"group/full fixed inset-0 z-40 bg-background data-idle:cursor-none data-idle:**:cursor-none",
					)}
				>
					{camMember ? (
						<CameraStage member={camMember} onExit={() => focusCamera(null)} />
					) : (
						<div
							className={cn(
								"grid min-h-0 w-full flex-1 gap-3",
								layout.columns === 2 ? "grid-cols-2" : "grid-cols-1",
								layout.main.length > 2 && "grid-rows-2",
							)}
						>
							{layout.main.map((id) => {
								const share = shareOf(id);
								const sharer = memberOf(id);
								if (!share || !sharer) return null;
								return (
									<WatchedShare
										key={id}
										share={share.track}
										sharer={sharer}
										inFocus={layout.inFocus === id}
										focused={focused === id}
										canFocus={open.length > 1}
										onFocus={() => focusShare(id)}
										onStop={() => unwatchShare(id)}
										fullscreen={fullscreen.active}
										onToggleFullscreen={fullscreen.toggle}
									/>
								);
							})}
						</div>
					)}
					<div
						aria-label="Participantes"
						className={cn(
							"flex max-w-full shrink-0 items-center gap-2 overflow-x-auto",
							// Na tela cheia a fileira fica por cima da parte de baixo da imagem, entre o
							// nome e os botões, e some com o mouse parado, junto com eles.
							fullscreen.active &&
								"absolute inset-x-0 bottom-8 z-10 mx-auto w-fit max-w-[calc(100%-24rem)] transition-opacity group-data-idle/full:pointer-events-none group-data-idle/full:opacity-0",
						)}
					>
						{(camMember ? open : layout.strip).map((id) => {
							const share = shareOf(id);
							const sharer = memberOf(id);
							if (!share || !sharer) return null;
							return (
								<SmallShare
									key={id}
									share={share.track}
									sharer={sharer}
									onFocus={() => focusShare(id)}
								/>
							);
						})}
						{notOpen.map((share) => {
							const sharer = memberOf(share.ownerId);
							if (!sharer) return null;
							return (
								<button
									key={share.ownerId}
									type="button"
									onClick={() => watchShare(share.ownerId)}
									className="flex h-[90px] w-40 shrink-0 flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-live/70 bg-rail px-2 text-center hover:bg-secondary"
								>
									<LiveBadge />
									<span className="max-w-full truncate text-xs font-semibold text-foreground">
										{sharer.name}
									</span>
									<span className="text-[11px] text-primary">Assistir</span>
								</button>
							);
						})}
						{members
							.filter((member) => member.id !== camMember?.id)
							.map((member) => (
								<ParticipantTile
									key={member.id}
									member={member}
									isLocal={member.isLocal}
									size="strip"
									onFocus={() => focusCamera(member.id)}
								/>
							))}
					</div>
				</div>
			) : (
				<RoomGrid tileMax={call ? CALL_TILE_MAX : undefined}>
					{shareState.status === "active" && screenShare && (
						<OwnShareTile
							controller={screenShare}
							source={shareState.source}
							paused={shareState.paused}
						/>
					)}
					{remotes.map((share) => {
						const sharer = memberOf(share.ownerId);
						if (!sharer) return null;
						return (
							<ShareTile
								key={share.ownerId}
								title={`${sharer.name} está transmitindo`}
								source={
									parseShareTrackName(share.track.publication.trackName)?.title
								}
								action={
									<Button
										className="h-[34px]"
										onClick={() => watchShare(sharer.id)}
									>
										Assistir transmissão
									</Button>
								}
							/>
						);
					})}
					{members.map((member) => (
						<ParticipantTile
							key={member.id}
							member={member}
							isLocal={member.isLocal}
							onFocus={() => focusCamera(member.id)}
						/>
					))}
				</RoomGrid>
			)}
		</RoomFrame>
	);
}

/** A câmera em foco: grande, inteira (sem cortar), com o nome e o botão de sair do foco. */
function CameraStage({
	member,
	onExit,
}: {
	member: LiveMember;
	onExit: () => void;
}) {
	const camera = cameraTrackOf(member.participant);
	const mirror = useCameraChoice((state) => state.mirror) && member.isLocal;
	return (
		<section
			aria-label={`Câmera de ${member.name}`}
			className={cn(
				"relative min-h-0 w-full flex-1 overflow-hidden rounded-[10px] bg-rail",
				member.speaking && "shadow-[inset_0_0_0_2px_var(--color-speaking)]",
			)}
		>
			{camera && (
				<CameraVideo
					trackRef={camera}
					mirror={mirror}
					className="absolute inset-0 object-contain"
				/>
			)}
			<span className="absolute bottom-3 left-3 max-w-[calc(100%-24px)] truncate rounded-md bg-rail/80 px-2 py-1 text-[13px] font-semibold text-foreground">
				{member.name}
				{member.isLocal && (
					<span className="font-normal text-muted-foreground"> (você)</span>
				)}
			</span>
			<button
				type="button"
				aria-label="Sair do foco"
				title="Sair do foco"
				onClick={onExit}
				className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-md bg-rail/80 text-foreground hover:bg-rail"
			>
				<Minimize2Icon className="size-4" />
			</button>
		</section>
	);
}

/** Uma transmissão aberta no palco, com a qualidade que quem transmite avisou por último. */
function WatchedShare({
	share,
	sharer,
	...props
}: {
	share: TrackReference;
	sharer: LiveMember;
	inFocus: boolean;
	focused: boolean;
	canFocus: boolean;
	onFocus: () => void;
	onStop: () => void;
	fullscreen: boolean;
	onToggleFullscreen: () => void;
}) {
	const { room } = useVoice();
	const trackInfo = parseShareTrackName(share.publication.trackName);
	// A qualidade pode ter mudado depois de publicar: vale o aviso de quem transmite.
	const announced = useShareQuality(
		room,
		sharer.id,
		share.publication.trackName,
	);
	const info =
		trackInfo && announced ? { ...trackInfo, quality: announced } : trackInfo;
	return (
		<ScreenStage
			share={share}
			sharer={sharer}
			spec={info ? shareSpec(info) : undefined}
			{...props}
		/>
	);
}

/**
 * A tela cheia do palco: a janela vai para a tela cheia pelo Tauri e o palco cobre a janela inteira
 * (`fixed inset-0`). Não é a do WebView2 (`requestFullscreen`): numa janela sem a borda do Windows,
 * ela deixava uma faixa branca a cada segunda vez no mesmo monitor. Esc sai, e sair por fora (um
 * atalho do Windows) também desliga aqui.
 */
function useFullscreen() {
	const [active, setActive] = useState(false);
	useEffect(() => {
		if (!active) return;
		setWindowFullscreen(true);
		// Na captura, antes de o menu tratar o Esc: com um menu ou popover aberto, o Esc fecha só ele.
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (document.querySelector("[data-popup-open]")) return;
			setActive(false);
		};
		window.addEventListener("keydown", onKey, true);
		const stopWatching = watchWindowFullscreen((fullscreen) => {
			if (!fullscreen) setActive(false);
		});
		return () => {
			window.removeEventListener("keydown", onKey, true);
			stopWatching();
			setWindowFullscreen(false);
		};
	}, [active]);
	return { active, toggle: () => setActive((on) => !on) };
}

/** Quanto tempo o mouse fica parado na tela cheia até os botões e a fileira sumirem. */
const IDLE_MS = 2500;

/**
 * Se o mouse e o teclado estão parados há `IDLE_MS` (só enquanto `on`). Com um menu aberto (um
 * popover da transmissão) não conta como parado.
 */
function useIdle(on: boolean) {
	const [idle, setIdle] = useState(false);
	useEffect(() => {
		if (!on) {
			setIdle(false);
			return;
		}
		let timer = 0;
		const wake = () => {
			setIdle(false);
			window.clearTimeout(timer);
			timer = window.setTimeout(sleep, IDLE_MS);
		};
		const sleep = () => {
			if (document.querySelector("[data-popup-open]")) wake();
			else setIdle(true);
		};
		wake();
		const events = ["mousemove", "pointerdown", "keydown", "wheel"] as const;
		for (const name of events) window.addEventListener(name, wake);
		return () => {
			window.clearTimeout(timer);
			for (const name of events) window.removeEventListener(name, wake);
		};
	}, [on]);
	return idle;
}

/** O lugar da própria transmissão: a imagem que está indo, os ajustes e o parar. */
function OwnShareTile({
	controller,
	source,
	paused,
}: {
	controller: ScreenShareController;
	source: CaptureSource;
	paused: boolean;
}) {
	const preview = useThumbnails([source.source]).get(
		sourceRefKey(source.source),
	);
	return (
		<ShareTile
			title={paused ? "Sua transmissão está pausada" : "Você está transmitindo"}
			source={source.title}
			preview={preview}
			action={
				<div className="flex gap-2">
					<Button
						variant="secondary"
						className="h-[34px]"
						onClick={openSharePanel}
					>
						Ajustes
					</Button>
					<Button
						variant="danger"
						className="h-[34px]"
						onClick={() => void controller.stop()}
					>
						Parar de transmitir
					</Button>
				</div>
			}
		/>
	);
}

/** Os segundos desde que a conexão entrou (o tempo da ligação no cabeçalho). */
function useConnectedClock(since: number | null): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (since === null) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [since]);
	return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}

/** "0:42", "12:04", "1:02:03". */
function clockLabel(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const rest = String(seconds % 60).padStart(2, "0");
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
		: `${minutes}:${rest}`;
}
