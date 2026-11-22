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
	type ShareSummary,
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
					cardOpen={open}
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
 * Passar o mouse em quem está transmitindo abre o cartão com Assistir (quadro "Canais — assistir
 * pela lista"): entra na sala, se precisar, e abre a transmissão em foco. O clique na linha abre o
 * cartão da pessoa, e aí este some, para os dois não ficarem abertos juntos.
 */
function WatchPreview({
	trigger,
	cardOpen,
	member,
	roomId,
	roomName,
	inCall,
}: {
	trigger: ReactElement;
	/** O cartão da pessoa (o clique) está aberto. */
	cardOpen: boolean;
	member: ChannelMember;
	roomId: string;
	roomName: string;
	inCall: boolean;
}) {
	const { join } = useVoice();
	const { guard, dialog } = useGuardedJoin();
	const navigate = useNavigate();
	const onRoom = useMatch(paths.voiceRoom) !== null;
	const [hovered, setHovered] = useState(false);
	const share = member.share;
	const now = Date.now();

	function show() {
		watchShare(member.id);
		focusShare(member.id);
		if (!onRoom) void navigate(paths.voiceRoom);
	}

	function watch() {
		setHovered(false);
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
			<PreviewCard open={hovered && !cardOpen} onOpenChange={setHovered}>
				<PreviewCardTrigger render={trigger} />
				<PreviewCardContent
					aria-label={`Transmissão de ${member.name}`}
					className="w-80"
				>
					{/* Sem a imagem da transmissão (quem está fora não a recebe): o avatar desfocado
					    faz o fundo, e o Assistir fica no meio. */}
					<div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-rail">
						<Avatar
							nick={member.nick}
							displayName={member.name}
							size={180}
							className="pointer-events-none absolute scale-150 opacity-70 blur-2xl"
						/>
						<span className="absolute inset-0 bg-background/30" />
						<LiveBadge size="md" className="absolute top-2 left-2" />
						{share && (
							<span className="absolute top-2 right-2 rounded bg-background/80 px-1.5 py-0.5 font-mono text-[10px] text-secondary-foreground">
								{qualitySpec(share.quality)}
							</span>
						)}
						{share && (
							<span className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-md bg-background/80 px-2 py-0.5 text-xs text-foreground">
								{share.window ? `Janela: ${share.title}` : share.title}
							</span>
						)}
						<Button className="relative h-9 px-6 text-sm" onClick={watch}>
							<EyeIcon />
							Assistir
						</Button>
					</div>
					<div className="flex items-center gap-2.5">
						<Avatar nick={member.nick} displayName={member.name} size={32} />
						<div className="flex min-w-0 flex-col">
							<span className="truncate font-semibold text-foreground">
								{member.name} está transmitindo
							</span>
							<span className="truncate text-xs text-muted-foreground">
								{shareDetails(roomName, share, now)}
							</span>
						</div>
					</div>
				</PreviewCardContent>
			</PreviewCard>
			{dialog}
		</>
	);
}

/** "1080p60" → "1080p · 60". */
export function qualitySpec(quality: string): string {
	const match = /^(\d+p)(\d+)$/.exec(quality);
	return match ? `${match[1]} · ${match[2]}` : quality;
}

/** "em Jogatina · há 12 min · 2 assistindo", com o que a transmissão contou. */
export function shareDetails(
	roomName: string,
	share: ShareSummary | undefined,
	now: number,
): string {
	const parts = [`em ${roomName}`];
	if (share) {
		const minutes = Math.floor((now - share.startedAt) / 60_000);
		parts.push(
			minutes < 1
				? "agora"
				: minutes < 60
					? `há ${minutes} min`
					: `há ${Math.floor(minutes / 60)} h`,
		);
		if (share.viewers > 0) {
			parts.push(
				share.viewers === 1 ? "1 assistindo" : `${share.viewers} assistindo`,
			);
		}
	}
	return parts.join(" · ");
}
