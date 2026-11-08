import { type TrackReference, VideoTrack } from "@livekit/components-react";
import {
	DoorOpenIcon,
	Volume1Icon,
	Volume2Icon,
	VolumeXIcon,
	XIcon,
} from "lucide-react";
import {
	type ComponentProps,
	type PointerEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { shareOwner, useScreenShares } from "@/features/screen-share";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { useLiveMembers } from "../../members/hooks/useLiveMembers";
import type { ChannelMember } from "../../members/model/members";
import { useVoice } from "../../room/hooks/useVoice";
import { useShareAudio } from "../hooks/useShareAudio";
import {
	clampToArea,
	MINI_SIZE,
	type MiniCorner,
	nearestCorner,
} from "../model/miniCorner";
import { setMiniCorner, useMiniShare } from "../stores/miniShareStore";
import { setShown, stopWatching, useRoomView } from "../stores/roomViewStore";
import { setShareVolume, toggleShareMuted } from "../stores/shareVolumeStore";
import { LiveBadge } from "./LiveBadge";
import { PausedCover } from "./PausedCover";

/*
 * A miniatura da transmissão: quem assiste alguém no Foco e sai da sala (para um canal de texto)
 * continua vendo a transmissão num quadro de 320×180 num canto da área do canal. Passando o mouse,
 * aparecem o volume, "Voltar para a sala" e o X, que para de assistir.
 *
 * A miniatura arrasta e, solta, vai para o canto mais perto, que fica gravado. Nas configurações
 * ela some, e a tela deixa de ser baixada até a pessoa sair delas (`shown` do `roomView`).
 *
 * Montada uma vez, no `AppShell`, numa camada do tamanho da área do canal (empilhada sobre o `main`,
 * que não pode ser posicionado: ver o `AppShell`). A camada deixa o clique passar, e a miniatura o
 * recebe (`pointer-events-auto`).
 */
export function MiniShare() {
	const { room } = useVoice();
	const watching = useRoomView((state) => state.watching);
	const inRoom = useMatch(paths.voiceRoom) !== null;
	const inSettings = useMatch(`${paths.settings.root}/*`) !== null;
	if (!room || !watching || inRoom || inSettings) return null;
	return <WatchedShare watching={watching} />;
}

/** Acha a transmissão assistida; se ela acabou, para de assistir. */
function WatchedShare({ watching }: { watching: string }) {
	const { winner } = useScreenShares();
	const members = useLiveMembers();
	const watched =
		winner && !winner.isOwn && winner.ownerId === watching
			? winner.track
			: undefined;
	const sharer = members.find((member) => member.id === watching);

	// Como no Foco: só depois de a transmissão ter aparecido, porque no primeiro desenho a lista
	// de trilhas ainda vem vazia.
	const seen = useRef(false);
	if (watched) seen.current = true;
	useEffect(() => {
		if (!watched && seen.current) {
			seen.current = false;
			stopWatching();
		}
	}, [watched]);

	if (!watched || !sharer) return null;
	return <MiniShareFrame share={watched} sharer={sharer} />;
}

function MiniShareFrame({
	share,
	sharer,
}: {
	share: TrackReference;
	sharer: ChannelMember;
}) {
	const navigate = useNavigate();
	const corner = useMiniShare((state) => state.corner);
	const frame = useRef<HTMLElement>(null);
	// Enquanto arrasta: onde a miniatura está, relativa à área do canal.
	const [drag, setDrag] = useState<{ left: number; top: number } | null>(null);
	const grab = useRef<{ x: number; y: number } | null>(null);

	const sharerId = shareOwner(share.participant.identity);
	useEffect(() => {
		setShown(sharerId);
		return () => setShown(null);
	}, [sharerId]);
	const { remoteAudio, heard } = useShareAudio(share);

	const area = () => {
		const parent = frame.current?.offsetParent as HTMLElement | null;
		return {
			width: parent?.clientWidth ?? 0,
			height: parent?.clientHeight ?? 0,
		};
	};

	function onPointerDown(event: PointerEvent<HTMLElement>) {
		// Os botões e o volume não arrastam.
		if (
			event.button !== 0 ||
			(event.target as HTMLElement).closest("button, [role=slider]")
		) {
			return;
		}
		const box = frame.current;
		if (!box) return;
		box.setPointerCapture(event.pointerId);
		grab.current = {
			x: event.clientX - box.offsetLeft,
			y: event.clientY - box.offsetTop,
		};
		setDrag({ left: box.offsetLeft, top: box.offsetTop });
	}

	function onPointerMove(event: PointerEvent<HTMLElement>) {
		if (!grab.current) return;
		setDrag(
			clampToArea(
				{
					left: event.clientX - grab.current.x,
					top: event.clientY - grab.current.y,
				},
				area(),
			),
		);
	}

	function onPointerUp() {
		if (!grab.current || !drag) return;
		grab.current = null;
		setMiniCorner(
			nearestCorner(
				{
					x: drag.left + MINI_SIZE.width / 2,
					y: drag.top + MINI_SIZE.height / 2,
				},
				area(),
			),
		);
		setDrag(null);
	}

	const ready = share.publication.isSubscribed && share.publication.track;

	return (
		<section
			ref={frame}
			aria-label={`Transmissão de ${sharer.name}, em miniatura`}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			style={drag ?? undefined}
			data-corner={corner}
			className={cn(
				"group/mini pointer-events-auto absolute z-20 flex touch-none items-center justify-center overflow-hidden rounded-[10px] border border-border-strong bg-rail shadow-xl select-none",
				"h-[180px] w-[320px]",
				drag ? "cursor-grabbing" : cn("cursor-grab", CORNER_CLASS[corner]),
			)}
		>
			{ready ? (
				<VideoTrack
					trackRef={share}
					className="pointer-events-none size-full object-contain"
				/>
			) : (
				<Spinner className="size-5 text-primary" />
			)}
			{ready && share.publication.isMuted && <PausedCover compact />}

			<LiveBadge className="absolute top-2 left-2" />
			<div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-rail/95 to-transparent px-2 pt-6 pb-2 opacity-0 transition-opacity group-hover/mini:opacity-100 group-focus-within/mini:opacity-100">
				<span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
					{sharer.name}
				</span>
				{remoteAudio && (
					<>
						<MiniButton
							aria-label="Silenciar transmissão"
							aria-pressed={heard === 0}
							onClick={toggleShareMuted}
						>
							{heard === 0 ? (
								<VolumeXIcon />
							) : heard < 50 ? (
								<Volume1Icon />
							) : (
								<Volume2Icon />
							)}
						</MiniButton>
						<Slider
							aria-label="Volume da transmissão"
							min={0}
							max={100}
							value={heard}
							onValueChange={setShareVolume}
							className="w-16"
						/>
					</>
				)}
				<MiniButton
					aria-label="Voltar para a sala"
					onClick={() => void navigate(paths.voiceRoom)}
				>
					<DoorOpenIcon />
				</MiniButton>
				<MiniButton aria-label="Parar de assistir" onClick={stopWatching}>
					<XIcon />
				</MiniButton>
			</div>
		</section>
	);
}

/** Cada canto pelas classes, para a miniatura ficar no canto quando a janela muda de tamanho. */
const CORNER_CLASS: Record<MiniCorner, string> = {
	"top-left": "top-4 left-4",
	"top-right": "top-4 right-4",
	"bottom-left": "bottom-4 left-4",
	"bottom-right": "bottom-4 right-4",
};

function MiniButton({
	className,
	children,
	...props
}: ComponentProps<"button"> & { children: ReactNode }) {
	return (
		<button
			type="button"
			className={cn(
				"flex size-7 shrink-0 items-center justify-center rounded-md bg-rail/85 text-foreground hover:bg-secondary [&_svg]:size-3.5",
				className,
			)}
			{...props}
		>
			{children}
		</button>
	);
}
