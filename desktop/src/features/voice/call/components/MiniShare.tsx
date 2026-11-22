import { type TrackReference, VideoTrack } from "@livekit/components-react";
import {
	ChevronLeftIcon,
	ChevronRightIcon,
	ChevronsLeftIcon,
	ChevronsRightIcon,
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
import { Avatar } from "@/features/identity";
import { shareOwner, useScreenShares } from "@/features/screen-share";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { useLiveMembers } from "../../members/hooks/useLiveMembers";
import type { ChannelMember } from "../../members/model/members";
import { useVoice } from "../../room/hooks/useVoice";
import { useShareAudio } from "../hooks/useShareAudio";
import {
	clampToArea,
	MINI_CORNERS,
	MINI_SIZE,
	type MiniCorner,
	miniSide,
	nearestCorner,
	slotPosition,
} from "../model/miniCorner";
import {
	setMiniCollapsed,
	setMiniCorner,
	useMiniShare,
} from "../stores/miniShareStore";
import {
	pickMiniShare,
	setShown,
	unwatchShare,
	useRoomView,
} from "../stores/roomViewStore";
import {
	MAX_SHARE_VOLUME,
	setShareVolume,
	toggleShareMuted,
} from "../stores/shareVolumeStore";
import { LiveBadge } from "./LiveBadge";
import { PausedCover } from "./PausedCover";
import { ShareQualityButton } from "./ShareQualityButton";

/*
 * A miniatura da transmissão: quem assiste alguém no Foco e sai da sala (para um canal de texto)
 * continua vendo a transmissão num quadro de 320×180 num canto da área do canal. Com várias abertas,
 * ela mostra uma de cada vez, e as setas (com o "1/2") trocam qual, sem voltar para a sala; só a que
 * aparece é baixada (ADR 0024). Passando o mouse,
 * aparecem recolher e o X (que para de assistir) em cima, "Voltar para a sala" no meio e o volume
 * embaixo.
 *
 * A miniatura arrasta: enquanto isso, ela cresce um pouco, ganha a borda azul e mostra os seis
 * encaixes (os cantos e o meio de cada lateral), com o mais perto destacado. Solta, vai para ele, que
 * fica gravado. Recolhida, vira uma aba presa na lateral, com quem transmite: o canal fica livre e o
 * som continua; clicar na aba abre de novo. Nas configurações ela some, e a tela deixa de ser
 * baixada até a pessoa sair delas (`shown` do `roomView`).
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
	if (!room || watching.length === 0 || inRoom || inSettings) return null;
	return <WatchedShare watching={watching} />;
}

/**
 * Acha a transmissão que a miniatura mostra (ADR 0024): com várias abertas, a que estava em foco,
 * a escolhida pelas setas ou a primeira aberta. As que acabam saem da lista no `WatchJanitor`.
 */
function WatchedShare({ watching }: { watching: readonly string[] }) {
	const shares = useScreenShares();
	const members = useLiveMembers();
	const focused = useRoomView((state) => state.focused);
	const miniPick = useRoomView((state) => state.miniPick);

	const open = watching.filter((id) =>
		shares.some(
			(share) =>
				!share.isOwn &&
				share.ownerId === id &&
				members.some((member) => member.id === id),
		),
	);
	const current =
		(miniPick && open.includes(miniPick) ? miniPick : null) ??
		(focused && open.includes(focused) ? focused : null) ??
		open[0];
	const watched = shares.find((share) => share.ownerId === current)?.track;
	const sharer = members.find((member) => member.id === current);

	if (!current || !watched || !sharer) return null;
	const index = open.indexOf(current);
	const step = (delta: number) => {
		const next = open[(index + delta + open.length) % open.length];
		if (next) pickMiniShare(next);
	};
	return (
		<MiniShareFrame
			share={watched}
			sharer={sharer}
			position={open.length > 1 ? { index, total: open.length } : null}
			onPrevious={() => step(-1)}
			onNext={() => step(1)}
		/>
	);
}

function MiniShareFrame({
	share,
	sharer,
	position,
	onPrevious,
	onNext,
}: {
	share: TrackReference;
	sharer: ChannelMember;
	/** Com várias abertas: qual esta é, para as setas e o "1/2". */
	position: { index: number; total: number } | null;
	onPrevious: () => void;
	onNext: () => void;
}) {
	const navigate = useNavigate();
	const corner = useMiniShare((state) => state.corner);
	const collapsed = useMiniShare((state) => state.collapsed);
	const frame = useRef<HTMLElement>(null);
	// Enquanto arrasta: onde a miniatura está, relativa à área do canal.
	const [drag, setDrag] = useState<{ left: number; top: number } | null>(null);
	const grab = useRef<{ x: number; y: number } | null>(null);

	const sharerId = shareOwner(share.participant.identity);
	useEffect(() => {
		setShown(sharerId, "full");
		return () => setShown(sharerId, null);
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
	const target = drag
		? nearestCorner(
				{
					x: drag.left + MINI_SIZE.width / 2,
					y: drag.top + MINI_SIZE.height / 2,
				},
				area(),
			)
		: null;

	if (collapsed) {
		const side = miniSide(corner);
		return (
			<button
				type="button"
				aria-label={`Abrir a miniatura da transmissão de ${sharer.name}`}
				onClick={() => setMiniCollapsed(false)}
				data-corner={corner}
				className={cn(
					"pointer-events-auto absolute z-20 flex items-center gap-2 border border-border-strong bg-rail py-2 shadow-xl hover:bg-secondary",
					side === "left"
						? "left-0 rounded-r-[10px] border-l-0 pr-3 pl-2"
						: "right-0 flex-row-reverse rounded-l-[10px] border-r-0 pr-2 pl-3",
					TAB_VERTICAL[corner],
				)}
			>
				{side === "left" ? (
					<ChevronsRightIcon className="size-4 text-muted-foreground" />
				) : (
					<ChevronsLeftIcon className="size-4 text-muted-foreground" />
				)}
				<Avatar nick={sharer.nick} displayName={sharer.name} size={24} />
				<LiveBadge />
			</button>
		);
	}

	return (
		<>
			{drag &&
				MINI_CORNERS.map((slot) => (
					<span
						key={slot}
						aria-hidden="true"
						data-slot-target={slot}
						data-nearest={slot === target ? "" : undefined}
						style={{ ...slotPosition(slot, area()), ...MINI_SIZE }}
						className={cn(
							"pointer-events-none absolute z-10 rounded-[10px] border-2 border-dashed",
							slot === target
								? "border-primary bg-primary/10"
								: "border-border-strong/70",
						)}
					/>
				))}
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
					"group/mini pointer-events-auto absolute z-20 flex touch-none items-center justify-center overflow-hidden rounded-[14px] border bg-rail shadow-xl select-none",
					"h-[180px] w-[320px]",
					drag
						? "scale-[1.04] cursor-grabbing border-2 border-primary"
						: cn("cursor-grab border-border-strong", CORNER_CLASS[corner]),
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
				{ready && <PausedCover share={share} compact />}
				<LiveBadge className="absolute top-2 left-2" />
				{drag ? (
					<span className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-xs font-semibold text-foreground">
						Solte para encaixar
					</span>
				) : (
					<div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-b from-rail/80 via-rail/30 to-rail/90 p-2 opacity-0 transition-opacity group-hover/mini:opacity-100 group-focus-within/mini:opacity-100">
						<div className="flex items-center justify-end gap-1">
							{position && (
								<div className="mr-auto flex items-center gap-1 rounded-md bg-rail/85 pr-1.5">
									<MiniButton
										aria-label="Transmissão anterior"
										className="bg-transparent"
										onClick={onPrevious}
									>
										<ChevronLeftIcon />
									</MiniButton>
									<span className="font-mono text-[11px] text-secondary-foreground">
										{position.index + 1}/{position.total}
									</span>
									<MiniButton
										aria-label="Próxima transmissão"
										className="bg-transparent"
										onClick={onNext}
									>
										<ChevronRightIcon />
									</MiniButton>
								</div>
							)}
							<MiniButton
								aria-label="Recolher a miniatura"
								onClick={() => setMiniCollapsed(true)}
							>
								{miniSide(corner) === "left" ? (
									<ChevronsLeftIcon />
								) : (
									<ChevronsRightIcon />
								)}
							</MiniButton>
							<MiniButton
								aria-label="Parar de assistir"
								onClick={() => unwatchShare(sharerId)}
							>
								<XIcon />
							</MiniButton>
						</div>
						<div className="flex justify-center">
							<button
								type="button"
								onClick={() => void navigate(paths.voiceRoom)}
								className="flex h-8 items-center gap-1.5 rounded-full bg-primary px-3.5 text-xs font-semibold text-primary-foreground hover:bg-primary-hover [&_svg]:size-3.5"
							>
								<DoorOpenIcon />
								Voltar para a sala
							</button>
						</div>
						<div className="flex items-center gap-1.5">
							<span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
								{sharer.name}
							</span>
							<ShareQualityButton
								owner={sharerId}
								name={sharer.name}
								compact
							/>
							{remoteAudio && (
								<>
									<MiniButton
										aria-label="Silenciar transmissão"
										aria-pressed={heard === 0}
										onClick={() => toggleShareMuted(sharerId)}
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
										max={MAX_SHARE_VOLUME}
										value={heard}
										onValueChange={(value) => setShareVolume(sharerId, value)}
										className="w-20"
									/>
								</>
							)}
						</div>
					</div>
				)}
			</section>
		</>
	);
}

/** Cada canto pelas classes, para a miniatura ficar no canto quando a janela muda de tamanho. */
const CORNER_CLASS: Record<MiniCorner, string> = {
	"top-left": "top-4 left-4",
	"top-right": "top-4 right-4",
	left: "top-1/2 left-4 -translate-y-1/2",
	right: "top-1/2 right-4 -translate-y-1/2",
	"bottom-left": "bottom-4 left-4",
	"bottom-right": "bottom-4 right-4",
};

/** A altura da aba recolhida: a do encaixe de onde ela saiu. */
const TAB_VERTICAL: Record<MiniCorner, string> = {
	"top-left": "top-4",
	"top-right": "top-4",
	left: "top-1/2 -translate-y-1/2",
	right: "top-1/2 -translate-y-1/2",
	"bottom-left": "bottom-4",
	"bottom-right": "bottom-4",
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
