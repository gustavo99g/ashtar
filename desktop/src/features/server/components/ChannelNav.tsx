import {
	HashIcon,
	HeadphoneOffIcon,
	MicOffIcon,
	Volume2Icon,
} from "lucide-react";
import { useMatch, useNavigate } from "react-router-dom";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { textChannels, useChannelLayout } from "@/features/channels";
import { Avatar, useSession } from "@/features/identity";
import {
	type ChannelMember,
	LiveBadge,
	memberFromApi,
	PersonCard,
	SALA,
	useLiveMembers,
	useVoice,
	useVoiceParticipants,
} from "@/features/voice";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";

/*
 * A coluna do servidor: os canais de texto, a sala e quem está nela. Clicar num canal abre a
 * conversa; clicar na sala entra na chamada, e quem já está nela só volta para a chamada.
 * A Etapa 7 troca esta lista pela árvore com as categorias.
 * Fora da chamada a lista vem da API (de 5 em 5 segundos); dentro, do LiveKit, com quem fala, sem
 * microfone e sem áudio.
 */
export function ChannelNav() {
	const { room, voiceChannelId } = useVoice();
	const inCall = voiceChannelId === SALA.id;
	return room && inCall ? <LiveChannel /> : <ApiChannel inCall={inCall} />;
}

function LiveChannel() {
	return <ChannelEntries members={useLiveMembers()} inCall />;
}

function ApiChannel({ inCall }: { inCall: boolean }) {
	// Entrando na chamada, para de perguntar e fica com a última lista até o LiveKit responder.
	const { data } = useVoiceParticipants(SALA.id, { enabled: !inCall });
	return (
		<ChannelEntries members={data?.map(memberFromApi) ?? []} inCall={inCall} />
	);
}

function ChannelEntries({
	members,
	inCall,
}: {
	members: ChannelMember[];
	inCall: boolean;
}) {
	const session = useSession();
	const myId = session.status === "connected" ? session.user.id : null;
	const { join } = useVoice();
	const navigate = useNavigate();
	const onRoom = useMatch(paths.voiceRoom) !== null;
	// A sala fica marcada só na tela da chamada: a do servidor agora é o canal de texto.
	const selected = inCall && onRoom;

	function openRoom() {
		if (!inCall) join(SALA.id);
		if (!onRoom) void navigate(paths.voiceRoom);
	}

	return (
		<nav
			aria-label="Salas"
			className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto py-2"
		>
			<TextChannels />
			<div className="px-4 pt-3 pb-1 text-[11px] font-bold tracking-[0.06em] text-muted-foreground uppercase">
				Sala de voz
			</div>
			<button
				type="button"
				aria-label={inCall ? `Abrir a ${SALA.name}` : `Entrar na ${SALA.name}`}
				aria-current={selected ? "page" : undefined}
				onClick={openRoom}
				className={cn(
					"mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-semibold",
					selected
						? "bg-selected text-selected-foreground"
						: "text-muted-foreground hover:bg-secondary hover:text-foreground",
				)}
			>
				<Volume2Icon aria-hidden="true" className="size-[18px]" />
				<span>{SALA.name}</span>
				{members.length > 0 && (
					<span className="ml-auto font-mono text-[11px] font-normal text-secondary-foreground">
						{members.length}
					</span>
				)}
			</button>
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

function TextChannels() {
	const { data } = useChannelLayout();
	const navigate = useNavigate();
	const match = useMatch(paths.channelPattern);
	if (!data) return null;
	return (
		<>
			<div className="px-4 pt-3 pb-1 text-[11px] font-bold tracking-[0.06em] text-muted-foreground uppercase">
				Canais de texto
			</div>
			{textChannels(data).map((channel) => {
				const selected = match?.params.channelId === channel.id;
				return (
					<button
						key={channel.id}
						type="button"
						aria-current={selected ? "page" : undefined}
						onClick={() => void navigate(paths.channel(channel.id))}
						className={cn(
							"mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-semibold",
							selected
								? "bg-selected text-selected-foreground"
								: "text-muted-foreground hover:bg-secondary hover:text-foreground",
						)}
					>
						<HashIcon aria-hidden="true" className="size-[18px] shrink-0" />
						<span className="truncate">{channel.name}</span>
					</button>
				);
			})}
		</>
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
