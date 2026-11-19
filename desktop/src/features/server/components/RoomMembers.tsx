import { HeadphoneOffIcon, MicOffIcon } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { COLLAPSED_AVATARS } from "@/features/channels";
import { Avatar } from "@/features/identity";
import { UserCardPopup } from "@/features/members";
import {
	type ChannelMember,
	LiveBadge,
	RoomModeration,
	UserVolume,
} from "@/features/voice";
import { cn } from "@/lib/utils";
import { useMemberDrag } from "./MemberDrag";

/*
 * Quem está numa sala de voz, do jeito que a coluna mostra: a lista de nomes embaixo da sala
 * (`RoomMembers`) e, com a categoria recolhida, só os avatares na própria linha (`AvatarStrip`).
 * Clicar num nome abre o cartão da pessoa (`UserCardPopup`), o mesmo da lista de membros.
 */

export function RoomMembers({
	members,
	myId,
	roomId,
	roomName,
	inCall,
}: {
	members: ChannelMember[];
	myId: string | null;
	roomId: string;
	roomName: string;
	/** Quem usa está nesta sala: aí o cartão dos outros tem o volume. */
	inCall: boolean;
}) {
	return (
		<ul aria-label={`Quem está na ${roomName}`} className="flex flex-col gap-0.5">
			{members.map((member) => (
				<li key={member.id}>
					<MemberRow
						member={member}
						isMe={member.id === myId}
						roomId={roomId}
						roomName={roomName}
						inCall={inCall}
					/>
				</li>
			))}
		</ul>
	);
}

/** Recolhida: até 5 avatares, "+N" para o resto e o selo de quem transmite. */
export function AvatarStrip({ members }: { members: ChannelMember[] }) {
	if (members.length === 0) return null;
	const shown = members.slice(0, COLLAPSED_AVATARS);
	const rest = members.length - shown.length;
	const sharing = members.some((member) => member.sharing);
	return (
		<span
			className="ml-auto flex shrink-0 items-center gap-1.5"
			aria-label={`${members.length} na sala${sharing ? ", com transmissão" : ""}`}
		>
			{sharing && <LiveBadge />}
			<span className="flex -space-x-1.5">
				{shown.map((member) => (
					<Avatar
						key={member.id}
						nick={member.nick}
						displayName={member.name}
						size={20}
						className="ring-2 ring-card"
					/>
				))}
			</span>
			{rest > 0 && (
				<span className="font-mono text-[11px] font-normal text-secondary-foreground">
					+{rest}
				</span>
			)}
		</span>
	);
}

function MemberRow({
	member,
	isMe,
	roomId,
	roomName,
	inCall,
}: {
	member: ChannelMember;
	isMe: boolean;
	roomId: string;
	roomName: string;
	inCall: boolean;
}) {
	// Controlado, para o "Mover para" e o "Desconectar" fecharem o cartão.
	const [open, setOpen] = useState(false);
	const drag = useMemberDrag(
		{ userId: member.id, name: member.name, roomId },
		isMe,
	);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				ref={drag.setNodeRef}
				{...(drag.enabled ? drag.listeners : {})}
				className={cn(
					drag.isDragging && "opacity-50",
					"mx-2 flex w-[calc(100%-16px)] items-center gap-2 rounded-md py-[3px] pr-2 pl-[42px] text-left text-[13px]",
					"text-muted-foreground hover:bg-secondary hover:text-foreground data-popup-open:bg-secondary",
					isMe && "text-foreground",
				)}
			>
				<Avatar
					nick={member.nick}
					displayName={member.name}
					size={22}
					className={cn(
						member.speaking &&
							"ring-2 ring-speaking ring-offset-2 ring-offset-card",
					)}
				/>
				<span className={cn("min-w-0 truncate", isMe && "text-gold")}>
					{member.name}
				</span>
				<span className="ml-auto flex shrink-0 items-center">
					{member.sharing ? (
						<LiveBadge />
					) : member.deafened ? (
						<HeadphoneOffIcon
							aria-label="áudio desativado"
							className="size-3.5 text-destructive-border"
						/>
					) : member.micOff ? (
						<MicOffIcon
							aria-label="microfone desativado"
							className="size-3.5 text-destructive-border"
						/>
					) : null}
				</span>
			</PopoverTrigger>
			<UserCardPopup
				side="right"
				person={{
					nick: member.nick,
					name: member.name,
					// Quem está na sala está online, mesmo Invisível (ADR 0022).
					online: true,
					room: { name: roomName, sharing: member.sharing },
				}}
			>
				{/* Só de quem você está ouvindo, e nunca no seu próprio cartão. */}
				{inCall && !isMe && (
					<UserVolume userId={member.id} name={member.name} />
				)}
				{!isMe && (
					<RoomModeration
						userId={member.id}
						name={member.name}
						roomId={roomId}
						onDone={() => setOpen(false)}
					/>
				)}
			</UserCardPopup>
		</Popover>
	);
}
