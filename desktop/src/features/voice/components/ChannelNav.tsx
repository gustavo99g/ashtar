import { HeadphoneOffIcon, MicOffIcon, Volume2Icon } from "lucide-react";
import { NavLink } from "react-router-dom";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar, useSession } from "@/features/identity";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { SALA } from "../channel";
import type { ChannelMember } from "../members";
import { useChannelMembers } from "../useChannelMembers";
import { LiveBadge } from "./LiveBadge";
import { PersonCard } from "./PersonCard";

/*
 * A coluna do servidor: a sala e quem está nela. Sem canais de texto na 0.2.2. A sala leva à
 * tela do servidor, ou à chamada quando a pessoa já está nela.
 */
export function ChannelNav() {
	const { members, inCall } = useChannelMembers();
	const session = useSession();
	const myId = session.status === "connected" ? session.user.id : null;

	return (
		<nav
			aria-label="Salas"
			className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto py-2"
		>
			<div className="px-4 pt-3 pb-1 text-[11px] font-bold tracking-[0.06em] text-muted-foreground uppercase">
				Sala de voz
			</div>
			<NavLink
				to={inCall ? paths.voiceRoom : paths.server}
				className={({ isActive }) =>
					cn(
						"mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold",
						isActive
							? "bg-selected text-selected-foreground"
							: "text-muted-foreground hover:bg-secondary hover:text-foreground",
					)
				}
			>
				<Volume2Icon aria-hidden="true" className="size-[18px]" />
				<span>{SALA.name}</span>
				{members.length > 0 && (
					<span className="ml-auto font-mono text-[11px] font-normal text-secondary-foreground">
						{members.length}
					</span>
				)}
			</NavLink>
			{members.length > 0 && (
				<ul
					aria-label={`Quem está na ${SALA.name}`}
					className="flex flex-col gap-0.5"
				>
					{members.map((member) => (
						<li key={member.id}>
							<MemberRow member={member} isMe={member.id === myId} />
						</li>
					))}
				</ul>
			)}
		</nav>
	);
}

function MemberRow({ member, isMe }: { member: ChannelMember; isMe: boolean }) {
	return (
		<Popover>
			<PopoverTrigger
				className={cn(
					"mx-2 flex w-[calc(100%-16px)] items-center gap-2 rounded-md py-[3px] pr-2 pl-[34px] text-left text-[13px]",
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
					channelName={SALA.name}
				/>
			</PopoverContent>
		</Popover>
	);
}
