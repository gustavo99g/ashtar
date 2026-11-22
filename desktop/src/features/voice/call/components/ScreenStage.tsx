import { type TrackReference, VideoTrack } from "@livekit/components-react";
import type { Participant } from "livekit-client";
import {
	Maximize2Icon,
	MaximizeIcon,
	MinimizeIcon,
	Minimize2Icon,
	Volume1Icon,
	Volume2Icon,
	VolumeXIcon,
} from "lucide-react";
import { type ComponentProps, type ReactNode, useEffect, useRef } from "react";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Avatar } from "@/features/identity";
import { shareOwner } from "@/features/screen-share";
import { cn } from "@/lib/utils";
import {
	CameraVideo,
	cameraTrackOf,
} from "../../camera/components/CameraVideo";
import type { ChannelMember } from "../../members/model/members";
import { useShareAudio } from "../hooks/useShareAudio";
import { setShown, type ShownSize } from "../stores/roomViewStore";
import {
	MAX_SHARE_VOLUME,
	setShareVolume,
	toggleShareMuted,
} from "../stores/shareVolumeStore";
import {
	CopyFrameButton,
	InboundStatsButton,
	ZoomableVideo,
} from "./FocusTools";
import { ShareQualityButton } from "./ShareQualityButton";
import { LiveBadge } from "./LiveBadge";
import { PausedCover } from "./PausedCover";
import { ShareViewers } from "./ShareViewers";

/*
 * Uma transmissão no palco (ADR 0024): o vídeo, quem transmite no canto, quem está assistindo, o
 * volume do áudio dela, Focar e Parar de assistir. O volume fica gravado por quem transmite
 * (`shareVolumeStore.ts`) e vale para a próxima transmissão da mesma pessoa.
 *
 * A transmissão em foco (sozinha no palco: a focada ou a única aberta) ganha também a tela cheia e
 * as ferramentas de quem assiste (`FocusTools.tsx`): ampliar, copiar um quadro e ver como está
 * chegando.
 * Lado a lado e no 2×2, nenhuma delas aparece (combinado em 19/11).
 *
 * A tela de quem transmite só é baixada enquanto este bloco existe, no tamanho dele (`setShown`).
 *
 * Quem transmite com a câmera ligada aparece com ela pequena no canto da própria transmissão, em
 * cima do nome (ADR 0025), e não num bloco a mais.
 */

interface ScreenStageProps {
	share: TrackReference;
	/** Com o `participant`, a câmera de quem transmite aparece no canto. */
	sharer: ChannelMember & { participant?: Participant };
	/** "1080p · 30 fps", quando se sabe. */
	spec?: string;
	/** Sozinha no palco: a tela cheia e as ferramentas aparecem. */
	inFocus: boolean;
	/** Se foi a pessoa que pôs esta em foco (o botão vira "Dividir"). */
	focused: boolean;
	/** Se dá para pôr em foco ou voltar para a divisão (com uma só aberta, não há o que dividir). */
	canFocus: boolean;
	onFocus: () => void;
	onStop: () => void;
	fullscreen: boolean;
	onToggleFullscreen: () => void;
}

/**
 * O que fica por cima da imagem (o AO VIVO, quem transmite, quem assiste e os botões) só aparece com
 * o mouse em cima, com o foco do teclado dentro ou com um popover dele aberto: parado, a tela fica
 * limpa.
 */
const ON_HOVER =
	"opacity-0 transition-opacity group-hover/stage:opacity-100 group-focus-within/stage:opacity-100 group-has-[[data-popup-open]]/stage:opacity-100";

export function ScreenStage({
	share,
	sharer,
	spec,
	inFocus,
	focused,
	canFocus,
	onFocus,
	onStop,
	fullscreen,
	onToggleFullscreen,
}: ScreenStageProps) {
	const owner = shareOwner(share.participant.identity);
	useShownAs(owner, "full");
	const { remoteAudio, heard } = useShareAudio(share);

	const ready = share.publication.isSubscribed && share.publication.track;
	const box = useRef<HTMLElement>(null);
	const camera = cameraTrackOf(sharer.participant);
	const video = (
		<VideoTrack trackRef={share} className="size-full object-contain" />
	);

	return (
		<section
			aria-label={`Transmissão de ${sharer.name}`}
			ref={box}
			className="group/stage relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-[10px] bg-rail"
		>
			{ready ? (
				inFocus ? (
					<ZoomableVideo>{video}</ZoomableVideo>
				) : (
					video
				)
			) : (
				<Spinner className="size-6 text-primary" />
			)}
			{ready && <PausedCover share={share} />}
			<div
				className={cn(
					"absolute top-3.5 left-3.5 flex items-center gap-2",
					ON_HOVER,
				)}
			>
				<LiveBadge size="md" />
			</div>
			<ShareViewers
				owner={owner}
				className={cn("absolute top-3.5 right-3.5", ON_HOVER)}
			/>
			{camera && (
				<div
					aria-label={`Câmera de ${sharer.name}`}
					role="img"
					className={cn(
						"absolute left-3.5 aspect-video overflow-hidden rounded-lg bg-rail ring-1 ring-border-strong",
						inFocus ? "bottom-16 w-48" : "bottom-14 w-32",
					)}
				>
					<CameraVideo trackRef={camera} />
				</div>
			)}
			<div
				className={cn(
					"absolute bottom-3.5 left-3.5 flex min-w-0 items-center gap-2 rounded-lg bg-rail/85 py-1.5 pr-2.5 pl-1.5",
					ON_HOVER,
				)}
			>
				<Avatar nick={sharer.nick} displayName={sharer.name} size={26} />
				<span className="truncate text-[13px] font-semibold text-foreground">
					{sharer.name}
				</span>
				{spec && inFocus && (
					<span className="font-mono text-[11px] text-secondary-foreground">
						{spec}
					</span>
				)}
			</div>
			<div
				className={cn(
					"absolute right-3.5 bottom-3.5 flex items-center gap-2",
					ON_HOVER,
				)}
			>
				{inFocus && ready && (
					<>
						<InboundStatsButton share={share} />
						<CopyFrameButton
							videoOf={() => box.current?.querySelector("video") ?? null}
						/>
					</>
				)}
				<ShareQualityButton owner={owner} name={sharer.name} />
				{remoteAudio && (
					<div className="flex h-9 items-center rounded-lg bg-rail/85 pr-3">
						<StageButton
							aria-label={`Silenciar a transmissão de ${sharer.name}`}
							aria-pressed={heard === 0}
							className="bg-transparent"
							onClick={() => toggleShareMuted(owner)}
						>
							{heard === 0 ? (
								<VolumeXIcon />
							) : heard < 50 ? (
								<Volume1Icon />
							) : (
								<Volume2Icon />
							)}
						</StageButton>
						<Slider
							aria-label={`Volume da transmissão de ${sharer.name}`}
							min={0}
							max={MAX_SHARE_VOLUME}
							value={heard}
							onValueChange={(value) => setShareVolume(owner, value)}
							className={inFocus ? "w-28" : "w-20"}
						/>
						<span
							className={cn(
								"ml-2 w-10 text-right font-mono text-xs",
								heard > 100 ? "text-live" : "text-muted-foreground",
							)}
						>
							{heard}%
						</span>
					</div>
				)}
				{canFocus && (
					<StageButton
						aria-label={focused ? "Dividir o palco" : `Focar em ${sharer.name}`}
						aria-pressed={focused}
						onClick={onFocus}
					>
						{focused ? <Minimize2Icon /> : <Maximize2Icon />}
					</StageButton>
				)}
				{inFocus && (
					<StageButton
						aria-label="Tela cheia"
						aria-pressed={fullscreen}
						onClick={onToggleFullscreen}
					>
						{fullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
					</StageButton>
				)}
				<StageButton
					className="w-auto px-3 text-[13px] font-semibold"
					onClick={onStop}
				>
					Parar de assistir
				</StageButton>
			</div>
		</section>
	);
}

/**
 * Uma transmissão pequena, na fileira de baixo (ADR 0024): a borda dourada, TRANSMITINDO e o nome.
 * Clicar põe ela em foco. Pede a camada leve, e o áudio dela continua tocando.
 */
export function SmallShare({
	share,
	sharer,
	onFocus,
}: {
	share: TrackReference;
	sharer: ChannelMember;
	onFocus: () => void;
}) {
	const owner = shareOwner(share.participant.identity);
	useShownAs(owner, "small");
	useShareAudio(share);
	const ready = share.publication.isSubscribed && share.publication.track;

	return (
		<button
			type="button"
			aria-label={`Focar na transmissão de ${sharer.name}`}
			onClick={onFocus}
			className="relative flex h-[90px] w-40 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-rail ring-2 ring-live hover:brightness-110"
		>
			{ready ? (
				<VideoTrack
					trackRef={share}
					className="pointer-events-none size-full object-contain"
				/>
			) : (
				<Spinner className="size-4 text-primary" />
			)}
			{ready && <PausedCover share={share} compact />}
			<LiveBadge className="absolute top-1.5 left-1.5" />
			<span className="absolute inset-x-1.5 bottom-1.5 truncate text-left text-[11px] font-semibold text-foreground [text-shadow:0_1px_2px_rgb(0_0_0/0.8)]">
				{sharer.name}
			</span>
		</button>
	);
}

/** Marca a transmissão de `owner` como à vista, nesse tamanho, e desmarca ao sair. */
function useShownAs(owner: string, size: ShownSize) {
	useEffect(() => {
		setShown(owner, size);
		return () => setShown(owner, null);
	}, [owner, size]);
}

export function StageButton({
	className,
	children,
	...props
}: ComponentProps<"button"> & { children: ReactNode }) {
	return (
		<button
			type="button"
			className={cn(
				"flex h-9 w-9 items-center justify-center rounded-lg bg-rail/85 text-foreground hover:bg-secondary [&_svg]:size-4",
				className,
			)}
			{...props}
		>
			{children}
		</button>
	);
}
