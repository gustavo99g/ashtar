import type { Participant } from "livekit-client";
import {
	HeadphoneOffIcon,
	MicOffIcon,
	ScreenShareIcon,
	VideoIcon,
} from "lucide-react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar } from "@/features/identity";
import { cn } from "@/lib/utils";
import {
	CameraVideo,
	cameraTrackOf,
} from "../../camera/components/CameraVideo";
import { useCameraChoice } from "../../camera/stores/cameraChoiceStore";
import type { ChannelMember } from "../model/members";
import { UserVolume, UserVolumeMark } from "./UserVolume";

/*
 * Uma pessoa na chamada: o avatar grande e o nome no canto, com os selos de transmitindo, sem
 * microfone e sem áudio. Quem fala ganha o contorno azul. Na Grade é grande; na faixa do Foco,
 * pequeno.
 *
 * Na Grade, clicar no bloco de outra pessoa abre o volume dela, logo abaixo (ADR 0020). Quem não
 * está em 100% ganha a marca no canto de cima, na Grade e na faixa. No próprio bloco, nada.
 *
 * Com a câmera ligada (ADR 0025), o vídeo dela toma o lugar do avatar, com o ícone de câmera ao
 * lado do nome; o anel de quem fala continua. A própria câmera aparece espelhada se a pessoa
 * escolheu Espelhar.
 */

interface ParticipantTileProps {
	/** Com o `participant` (quem está na chamada), o bloco mostra a câmera. */
	member: ChannelMember & { participant?: Participant };
	isLocal: boolean;
	size?: "grid" | "strip";
}

export function ParticipantTile({
	member,
	isLocal,
	size = "grid",
}: ParticipantTileProps) {
	const grid = size === "grid";
	const camera = cameraTrackOf(member.participant);
	const mirror = useCameraChoice((state) => state.mirror) && isLocal;
	const tileClass = cn(
		"relative flex items-center justify-center overflow-hidden bg-secondary",
		grid
			? "aspect-video w-full rounded-[10px]"
			: "h-20 w-[140px] shrink-0 rounded-lg",
		member.speaking && "shadow-[inset_0_0_0_2px_var(--color-speaking)]",
	);
	const content = (
		<>
			{camera ? (
				<>
					<CameraVideo
						trackRef={camera}
						mirror={mirror}
						className="absolute inset-0"
					/>
					{/* O anel de quem fala por cima do vídeo. */}
					{member.speaking && (
						<span
							aria-hidden="true"
							className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_2px_var(--color-speaking)]"
						/>
					)}
				</>
			) : (
				<Avatar
					nick={member.nick}
					displayName={member.name}
					size={grid ? 72 : 32}
				/>
			)}
			{!isLocal && (
				<UserVolumeMark
					userId={member.id}
					className={
						grid
							? "absolute top-2.5 right-2.5 px-2 py-1 text-xs"
							: "absolute top-1.5 right-1.5 px-1.5 py-0.5 text-[10px]"
					}
				/>
			)}
			<span
				className={cn(
					"absolute flex max-w-[calc(100%-20px)] items-center bg-rail/80 font-semibold text-foreground",
					grid
						? "bottom-2.5 left-2.5 gap-1.5 rounded-md px-2 py-1 text-[13px]"
						: "bottom-1.5 left-1.5 gap-1 rounded-sm px-1.5 py-0.5 text-[11px]",
				)}
			>
				<span className="truncate">
					{member.name}
					{isLocal && grid && (
						<span className="font-normal text-muted-foreground"> (você)</span>
					)}
				</span>
				{camera && (
					<VideoIcon
						aria-label="câmera ligada"
						className={cn(grid ? "size-3.5" : "size-[11px]", "shrink-0 text-muted-foreground")}
					/>
				)}
				<MemberIcons member={member} size={grid ? "size-3.5" : "size-[11px]"} />
			</span>
		</>
	);

	// O volume abre só na Grade e só no bloco dos outros.
	if (!grid || isLocal) return <div className={tileClass}>{content}</div>;

	return (
		<Popover>
			<PopoverTrigger
				aria-label={`Volume de ${member.name}`}
				className={cn(
					tileClass,
					"hover:shadow-[inset_0_0_0_2px_var(--color-border-strong)] data-popup-open:shadow-[inset_0_0_0_2px_var(--color-border-strong)]",
					member.speaking &&
						"hover:shadow-[inset_0_0_0_2px_var(--color-speaking)]",
				)}
			>
				{content}
			</PopoverTrigger>
			<PopoverContent
				side="bottom"
				sideOffset={8}
				aria-label={`Volume de ${member.name}`}
				className="w-[260px] gap-2 border-border-strong bg-card px-3.5 py-3"
			>
				<UserVolume userId={member.id} name={member.name} />
			</PopoverContent>
		</Popover>
	);
}

function MemberIcons({
	member,
	size,
}: {
	member: ChannelMember;
	size: string;
}) {
	return (
		<>
			{member.sharing && (
				<ScreenShareIcon
					aria-label="transmitindo a tela"
					className={cn(size, "shrink-0 text-link")}
				/>
			)}
			{member.deafened ? (
				<HeadphoneOffIcon
					aria-label="áudio desativado"
					className={cn(size, "shrink-0 text-destructive-border")}
				/>
			) : (
				member.micOff && (
					<MicOffIcon
						aria-label="microfone desativado"
						className={cn(size, "shrink-0 text-destructive-border")}
					/>
				)
			)}
		</>
	);
}

/** O lugar de quem está entrando: o avatar tracejado e "Conectando…". */
export function ConnectingTile({ nick, name }: { nick: string; name: string }) {
	return (
		<div className="flex aspect-video w-full max-w-[344px] flex-col items-center justify-center gap-2.5 rounded-[10px] bg-secondary">
			<Avatar
				nick={nick}
				displayName={name}
				size={72}
				className="border-2 border-dashed border-foreground-subtle bg-transparent!"
			/>
			<span className="text-[13px] text-secondary-foreground">Conectando…</span>
		</div>
	);
}
