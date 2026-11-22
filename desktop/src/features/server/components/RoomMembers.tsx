import { EyeIcon, HeadphoneOffIcon, MicOffIcon, VideoIcon } from "lucide-react";
import { type ReactElement, useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import {
	PreviewCard,
	PreviewCardContent,
	PreviewCardTrigger,
} from "@/components/ui/preview-card";
import { COLLAPSED_AVATARS } from "@/features/channels";
import { Avatar } from "@/features/identity";
import { UserCardPopup } from "@/features/members";
import {
	type ChannelMember,
	ConnectionMark,
	ConnectionSection,
	focusShare,
	LiveBadge,
	RoomModeration,
	useGuardedJoin,
	UserVolume,
	useVoice,
	watchShare,
} from "@/features/voice";
import { paths } from "@/lib/paths";
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
		<ul
			aria-label={`Quem está na ${roomName}`}
			className="flex flex-col gap-0.5"
		>
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
	const trigger = (
		<PopoverTrigger
			ref={drag.setNodeRef}
			{...(drag.enabled ? drag.listeners : {})}
			className={cn(
				drag.isDragging && "opacity-50",
				"mx-2 flex w-[calc(100%-16px)] items-center gap-2 rounded-md py-[3px] pr-2 pl-6 text-left text-[13px]",
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
			<span className="ml-auto flex shrink-0 items-center gap-1">
				<ConnectionMark connection={member.connection} className="size-3.5" />
				{member.camera && (
					<VideoIcon
						aria-label="câmera ligada"
						className="size-3.5 text-muted-foreground"
					/>
				)}
				{member.deafened ? (
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
				{member.sharing && <LiveBadge />}
			</span>
		</PopoverTrigger>
	);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			{member.sharing && !isMe ? (
				<WatchPreview
					trigger={trigger}
					member={member}
					roomId={roomId}
					roomName={roomName}
					inCall={inCall}
				/>
			) : (
				trigger
			)}
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
				{inCall && (
					<ConnectionSection
						userId={member.id}
						connection={member.connection}
					/>
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

/**
 * Passar o mouse em quem está transmitindo abre o cartão com Entrar e assistir (quadro "Canais —
 * assistir pela lista"): entra na sala, se precisar, e abre a transmissão em foco. Já na sala, é só
 * Assistir. O clique na linha continua abrindo o cartão da pessoa.
 */
function WatchPreview({
	trigger,
	member,
	roomId,
	roomName,
	inCall,
}: {
	trigger: ReactElement;
	member: ChannelMember;
	roomId: string;
	roomName: string;
	inCall: boolean;
}) {
	const { join } = useVoice();
	const { guard, dialog } = useGuardedJoin();
	const navigate = useNavigate();
	const onRoom = useMatch(paths.voiceRoom) !== null;

	function show() {
		watchShare(member.id);
		focusShare(member.id);
		if (!onRoom) void navigate(paths.voiceRoom);
	}

	function watch() {
		if (inCall) {
			show();
			return;
		}
		guard(roomName, () => {
			join(roomId);
			show();
		});
	}

	return (
		<>
			<PreviewCard>
				<PreviewCardTrigger render={trigger} />
				<PreviewCardContent aria-label={`Transmissão de ${member.name}`}>
					<div className="flex items-center gap-2.5">
						<Avatar nick={member.nick} displayName={member.name} size={32} />
						<div className="flex min-w-0 flex-col">
							<span className="truncate font-semibold text-foreground">
								{member.name} está transmitindo
							</span>
							<span className="truncate text-xs text-muted-foreground">
								em {roomName}
							</span>
						</div>
						<LiveBadge className="ml-auto shrink-0" />
					</div>
					<Button className="h-9 w-full text-sm" onClick={watch}>
						<EyeIcon />
						{inCall ? "Assistir" : "Entrar e assistir"}
					</Button>
				</PreviewCardContent>
			</PreviewCard>
			{dialog}
		</>
	);
}
