import { HeadphoneOffIcon, MicOffIcon } from "lucide-react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { COLLAPSED_AVATARS } from "@/features/channels";
import { Avatar } from "@/features/identity";
import { type ChannelMember, LiveBadge, PersonCard } from "@/features/voice";
import { cn } from "@/lib/utils";

/*
 * Quem está numa sala de voz, do jeito que a coluna mostra: a lista de nomes embaixo da sala
 * (`RoomMembers`) e, com a categoria recolhida, só os avatares na própria linha (`AvatarStrip`).
 */

export function RoomMembers({
	members,
	myId,
	roomName,
}: {
	members: ChannelMember[];
	myId: string | null;
	roomName: string;
}) {
	return (
		<ul aria-label={`Quem está na ${roomName}`} className="flex flex-col gap-0.5">
			{members.map((member) => (
				<li key={member.id}>
					<MemberRow
						member={member}
						isMe={member.id === myId}
						roomName={roomName}
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
	roomName,
}: {
	member: ChannelMember;
	isMe: boolean;
	roomName: string;
}) {
	return (
		<Popover>
			<PopoverTrigger
				className={cn(
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
			<PopoverContent
				side="right"
				align="start"
				sideOffset={16}
				aria-label={`Perfil de ${member.name}`}
				className="w-[280px] gap-0 overflow-hidden border-border-strong bg-card p-0"
			>
				<PersonCard
					nick={member.nick}
					name={member.name}
					sharing={member.sharing}
					channelName={roomName}
				/>
			</PopoverContent>
		</Popover>
	);
}
