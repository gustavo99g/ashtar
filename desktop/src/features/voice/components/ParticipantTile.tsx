import { HeadphoneOffIcon, MicOffIcon, ScreenShareIcon } from "lucide-react";
import { Avatar } from "@/features/identity";
import { cn } from "@/lib/utils";
import type { ChannelMember } from "../members";

/*
 * Uma pessoa na chamada: o avatar grande e o nome no canto, com os selos de transmitindo, sem
 * microfone e sem áudio. Quem fala ganha o contorno azul. Na Grade é grande; na faixa do Foco,
 * pequeno.
 */

interface ParticipantTileProps {
	member: ChannelMember;
	isLocal: boolean;
	size?: "grid" | "strip";
}

export function ParticipantTile({
	member,
	isLocal,
	size = "grid",
}: ParticipantTileProps) {
	const grid = size === "grid";
	return (
		<div
			className={cn(
				"relative flex items-center justify-center bg-secondary",
				grid
					? "aspect-video w-full rounded-[10px]"
					: "h-20 w-[140px] shrink-0 rounded-lg",
				member.speaking && "shadow-[inset_0_0_0_2px_var(--color-speaking)]",
			)}
		>
			<Avatar
				nick={member.nick}
				displayName={member.name}
				size={grid ? 72 : 32}
			/>
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
				<MemberIcons member={member} size={grid ? "size-3.5" : "size-[11px]"} />
			</span>
		</div>
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
