import { type TrackReference, VideoTrack } from "@livekit/components-react";
import {
	MaximizeIcon,
	MinimizeIcon,
	Volume1Icon,
	Volume2Icon,
	VolumeXIcon,
} from "lucide-react";
import {
	type ComponentProps,
	type ReactNode,
	type RefObject,
	useEffect,
	useState,
} from "react";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Avatar } from "@/features/identity";
import { cn } from "@/lib/utils";
import type { ChannelMember } from "../../members/model/members";
import { useShareAudio } from "../hooks/useShareAudio";
import { setShown } from "../stores/roomViewStore";
import { setShareVolume, toggleShareMuted } from "../stores/shareVolumeStore";
import { LiveBadge } from "./LiveBadge";

/*
 * O Foco: a transmissão grande, com quem transmite no canto, o volume do áudio da transmissão, a
 * tela cheia e o Parar de assistir. O volume fica gravado (`shareVolumeStore.ts`) e vale para a próxima
 * transmissão; a tela cheia é a do próprio webview e vale para o Foco inteiro (`fullscreenTarget`),
 * com a faixa de quem está na chamada. A tela de quem transmite só é baixada enquanto este palco
 * existe.
 */

interface ScreenStageProps {
	share: TrackReference;
	sharer: ChannelMember;
	/** "1080p · 30 fps", quando se sabe. */
	spec?: string;
	/** O que vai para a tela cheia: o Foco inteiro, com a faixa de baixo. */
	fullscreenTarget: RefObject<HTMLElement | null>;
	onStop: () => void;
}

export function ScreenStage({
	share,
	sharer,
	spec,
	fullscreenTarget,
	onStop,
}: ScreenStageProps) {
	const [fullscreen, setFullscreen] = useState(false);

	// Marca ao aparecer e desmarca ao sair: o `VoiceProvider` assina e cancela a tela.
	const sharerId = share.participant.identity;
	useEffect(() => {
		setShown(sharerId);
		return () => setShown(null);
	}, [sharerId]);

	const { remoteAudio, heard } = useShareAudio(share);
	useEffect(() => {
		const onChange = () =>
			setFullscreen(document.fullscreenElement === fullscreenTarget.current);
		document.addEventListener("fullscreenchange", onChange);
		return () => document.removeEventListener("fullscreenchange", onChange);
	}, [fullscreenTarget]);

	function toggleFullscreen() {
		if (document.fullscreenElement) void document.exitFullscreen();
		else void fullscreenTarget.current?.requestFullscreen();
	}

	const ready = share.publication.isSubscribed && share.publication.track;

	return (
		<section
			aria-label={`Transmissão de ${sharer.name}`}
			className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden rounded-[10px] bg-rail"
		>
			{ready ? (
				<VideoTrack trackRef={share} className="size-full object-contain" />
			) : (
				<Spinner className="size-6 text-primary" />
			)}
			<LiveBadge size="md" className="absolute top-3.5 left-3.5" />
			<div className="absolute bottom-3.5 left-3.5 flex items-center gap-2 rounded-lg bg-rail/85 py-1.5 pr-2.5 pl-1.5">
				<Avatar nick={sharer.nick} displayName={sharer.name} size={26} />
				<span className="text-[13px] font-semibold text-foreground">
					{sharer.name}
				</span>
				{spec && (
					<span className="font-mono text-[11px] text-secondary-foreground">
						{spec}
					</span>
				)}
			</div>
			<div className="absolute right-3.5 bottom-3.5 flex items-center gap-2">
				{remoteAudio && (
					<div className="flex h-9 items-center rounded-lg bg-rail/85 pr-3">
						<StageButton
							aria-label="Silenciar transmissão"
							aria-pressed={heard === 0}
							className="bg-transparent"
							onClick={toggleShareMuted}
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
							aria-label="Volume da transmissão"
							min={0}
							max={100}
							value={heard}
							onValueChange={setShareVolume}
							className="w-24"
						/>
					</div>
				)}
				<StageButton
					aria-label="Tela cheia"
					aria-pressed={fullscreen}
					onClick={toggleFullscreen}
				>
					{fullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
				</StageButton>
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

function StageButton({
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
