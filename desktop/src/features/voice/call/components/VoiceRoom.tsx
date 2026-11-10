import { type ReactNode, useEffect, useRef } from "react";
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
import type { CaptureSource } from "@/lib/tauri/commands";
import {
	ConnectingTile,
	ParticipantTile,
} from "../../members/components/ParticipantTile";
import { useLiveMembers } from "../../members/hooks/useLiveMembers";
import { useVoice } from "../../room/hooks/useVoice";
import { SALA } from "../../room/model/channel";
import { stopWatching, useRoomView, watchShare } from "../stores/roomViewStore";
import { CallControls } from "./CallControls";
import { RoomGrid } from "./RoomGrid";
import { LayoutToggle, RoomHeader } from "./RoomHeader";
import { ScreenStage } from "./ScreenStage";
import { ShareTile } from "./ShareTile";

/*
 * A sala de voz por dentro. Grade e Foco mostram as mesmas trilhas: a Grade, todo mundo e o lugar
 * de cada transmissão; o Foco, a transmissão que a pessoa escolheu assistir, com os outros numa
 * faixa embaixo (a tela cheia leva os dois juntos). A chamada mora no `VoiceProvider`, acima do
 * router: sair desta tela não sai da sala.
 */
export function VoiceRoom() {
	const {
		voiceChannelId,
		room,
		connectionState,
		error,
		join,
		leave,
		screenShare,
	} = useVoice();
	const navigate = useNavigate();

	if (voiceChannelId !== SALA.id) {
		return <Navigate to={paths.server} replace />;
	}

	function exit() {
		void navigate(paths.server, { replace: true });
		leave();
		stopWatching();
	}

	if (room) {
		return <ConnectedRoom onExit={exit} />;
	}

	const failed =
		connectionState === "error" || connectionState === "disconnected";
	return (
		<RoomFrame
			header={<RoomHeader />}
			controls={<CallControls controller={screenShare} onExit={exit} />}
		>
			{failed ? (
				<ErrorState
					title={
						connectionState === "error"
							? "Não foi possível entrar na sala"
							: "A conexão com a sala caiu"
					}
					description={
						error?.message ?? "Tente de novo. Se continuar, avise o dono."
					}
					onRetry={() => join(SALA.id)}
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

function ConnectedRoom({ onExit }: { onExit: () => void }) {
	const { screenShare } = useVoice();
	const { data: me } = useMe();

	const members = useLiveMembers();
	const shareState = useScreenShareState(screenShare);
	// Todas as publicações de tela, assinadas ou não.
	// Uma transmissão por vez: de fora, só a que vale pela regra (as outras param sozinhas).
	const { winner } = useScreenShares();
	const remote = winner && !winner.isOwn ? winner : undefined;
	const remoteShare = remote?.track;
	const remoteInfo = parseShareTrackName(remoteShare?.publication.trackName);

	const watching = useRoomView((state) => state.watching);
	const watched = remote?.ownerId === watching ? remoteShare : undefined;

	// A transmissão assistida acabou: volta para a Grade. Só depois de ela ter aparecido, porque
	// no primeiro desenho a lista de trilhas ainda vem vazia.
	const watchedSeen = useRef(false);
	if (watched) watchedSeen.current = true;
	useEffect(() => {
		if (watching && !watched && watchedSeen.current) {
			watchedSeen.current = false;
			stopWatching();
		}
	}, [watching, watched]);

	const memberOf = (identity: string) =>
		members.find((member) => member.id === identity);
	const remoteSharer = remote ? memberOf(remote.ownerId) : undefined;

	const sharer = watched ? remoteSharer : undefined;
	const focus = Boolean(watched && sharer);
	// O Foco inteiro (a transmissão e a faixa de quem está na chamada): é ele que vai para a tela cheia.
	const focusView = useRef<HTMLDivElement>(null);

	const subtitle =
		focus && sharer
			? `Assistindo ${sharer.name}`
			: `${members.length} ${members.length === 1 ? "participante" : "participantes"}`;

	return (
		<RoomFrame
			header={
				<RoomHeader
					subtitle={subtitle}
					actions={
						<>
							{me?.can_create_invite && (
								<QuickInvite canViewPanel={me.can_view_panel} />
							)}
							<LayoutToggle
								focus={focus}
								focusAvailable={remoteShare !== undefined}
								onGrid={stopWatching}
								onFocus={() => {
									if (remote) watchShare(remote.ownerId);
								}}
							/>
						</>
					}
				/>
			}
			controls={<CallControls controller={screenShare} onExit={onExit} />}
		>
			{focus && watched && sharer ? (
				<div
					ref={focusView}
					className="flex min-h-0 flex-1 flex-col items-center gap-4 px-6 pt-5 pb-4 [&:fullscreen]:bg-background"
				>
					<ScreenStage
						share={watched}
						sharer={sharer}
						spec={remoteInfo ? shareSpec(remoteInfo) : undefined}
						fullscreenTarget={focusView}
						onStop={stopWatching}
					/>
					<div
						aria-label="Participantes"
						className="flex max-w-full shrink-0 gap-2 overflow-x-auto"
					>
						{members.map((member) => (
							<ParticipantTile
								key={member.id}
								member={member}
								isLocal={member.isLocal}
								size="strip"
							/>
						))}
					</div>
				</div>
			) : (
				<RoomGrid>
					{shareState.status === "active" && screenShare && (
						<OwnShareTile
							controller={screenShare}
							source={shareState.source}
							paused={shareState.paused}
						/>
					)}
					{remoteShare && remoteSharer && (
						<ShareTile
							title={`${remoteSharer.name} está transmitindo`}
							source={remoteInfo?.title}
							action={
								<Button
									className="h-[34px]"
									onClick={() => watchShare(remoteSharer.id)}
								>
									Assistir transmissão
								</Button>
							}
						/>
					)}
					{members.map((member) => (
						<ParticipantTile
							key={member.id}
							member={member}
							isLocal={member.isLocal}
						/>
					))}
				</RoomGrid>
			)}
		</RoomFrame>
	);
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
