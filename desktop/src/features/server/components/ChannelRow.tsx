import { HashIcon, LockIcon, Volume2Icon } from "lucide-react";
import { type MouseEvent, type ReactNode, useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { shownWhenCollapsed } from "@/features/channels";
import { CountBadge, useReadState } from "@/features/unread";
import { useSession } from "@/features/identity";
import {
	type ChannelMember,
	memberFromApi,
	sharingFirst,
	useLiveMembers,
	useGuardedJoin,
	useVoice,
	useVoiceParticipants,
} from "@/features/voice";
import type { CategoryView, ChannelView } from "@/lib/api";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { ChannelMenu } from "./ChannelMenu";
import { useRoomDrop } from "./MemberDrag";
import { AvatarStrip, RoomMembers } from "./RoomMembers";

/*
 * Uma linha de canal na coluna (ADR 0020). A linha não reserva espaço para ferramenta nenhuma: a
 * engrenagem aparece por cima dela, à direita, só com o mouse na linha, com o foco ou com o menu
 * aberto. O botão direito na linha abre o mesmo menu. No canal de texto ela é de todo mundo (o
 * "Marcar como lido"); na sala de voz, só de quem gerencia.
 *
 * O canal de texto com não lidas fica com o nome em destaque e um ponto na beirada esquerda; com
 * menções a você, o número delas à direita. Silenciado, o nome fica apagado e sem ponto, mas o
 * número das menções aparece do mesmo jeito.
 */

/** O que quem gerencia os canais pode fazer a partir de uma linha. `null` para os outros. */
export interface ChannelManage {
	/** As categorias abertas: os destinos do "Mover para". */
	categories: CategoryView[];
	moveTo: (channelId: string, categoryId: string | null) => void;
}

interface RowProps {
	channel: ChannelView;
	/** A categoria do canal está recolhida: ele só aparece se tiver por quê. */
	collapsed: boolean;
	manage: ChannelManage | null;
}

export function ChannelRow(props: RowProps) {
	return props.channel.kind === "text" ? (
		<TextChannel {...props} />
	) : (
		<VoiceChannel {...props} />
	);
}

const rowClass = (selected: boolean) =>
	cn(
		"flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
		selected
			? "bg-selected font-semibold text-selected-foreground"
			: "font-normal text-muted-foreground hover:bg-secondary hover:text-foreground",
	);

/**
 * A moldura de uma linha: o botão do canal e, para quem gerencia, a engrenagem por cima. Guarda se
 * o menu está aberto, porque dois caminhos abrem o mesmo menu (a engrenagem e o botão direito).
 */
function RowFrame({
	channel,
	manage,
	children,
}: {
	channel: ChannelView;
	manage: ChannelManage | null;
	children: ReactNode;
}) {
	const [menuOpen, setMenuOpen] = useState(false);

	const hasMenu = manage !== null || channel.kind === "text";

	function onContextMenu(event: MouseEvent) {
		if (!hasMenu) return;
		event.preventDefault();
		setMenuOpen(true);
	}

	return (
		// O botão direito é um atalho: a engrenagem faz o mesmo pelo teclado.
		<div
			className="group/channel relative mx-2 flex items-center"
			onContextMenu={onContextMenu}
		>
			{children}
			{hasMenu && (
				<span
					className={cn(
						"absolute top-1/2 right-1 flex -translate-y-1/2 rounded bg-secondary opacity-0",
						"group-hover/channel:opacity-100 focus-within:opacity-100",
						menuOpen && "opacity-100",
					)}
				>
					<ChannelMenu
						channel={channel}
						manage={
							manage && {
								categories: manage.categories,
								onMoveTo: (categoryId) => manage.moveTo(channel.id, categoryId),
							}
						}
						open={menuOpen}
						onOpenChange={setMenuOpen}
					/>
				</span>
			)}
		</div>
	);
}

function TextChannel({ channel, collapsed, manage }: RowProps) {
	const navigate = useNavigate();
	const match = useMatch(paths.channelPattern);
	const selected = match?.params.channelId === channel.id;
	const { unread, mentions, muted } = useReadState(channel.id);
	// No canal aberto as novas são lidas na hora: não precisa chamar atenção.
	const fresh = unread > 0 && !muted && !selected;
	const mentioned = selected ? 0 : mentions;
	const shown =
		!collapsed ||
		shownWhenCollapsed(channel, {
			openChannelId: match?.params.channelId ?? null,
			currentRoomId: null,
			people: 0,
		});
	if (!shown) return null;
	return (
		<li>
			<RowFrame channel={channel} manage={manage}>
				<button
					type="button"
					aria-current={selected ? "page" : undefined}
					onClick={() => void navigate(paths.channel(channel.id))}
					className={cn(
						rowClass(selected),
						fresh && "font-semibold text-foreground",
						muted && !selected && "opacity-50",
					)}
				>
					{fresh && (
						<span
							aria-hidden="true"
							className="absolute top-1/2 -left-2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-foreground"
						/>
					)}
					<HashIcon aria-hidden="true" className="size-[18px] shrink-0" />
					<span className="truncate">{channel.name}</span>
					<RestrictedMark channel={channel} />
					{fresh && <span className="sr-only">, com mensagens novas</span>}
					{muted && <span className="sr-only">, silenciado</span>}
					<CountBadge
						count={mentioned}
						label={mentioned === 1 ? "1 menção" : `${mentioned} menções`}
						className="ml-auto shrink-0"
					/>
				</button>
			</RowFrame>
		</li>
	);
}

/**
 * Quem está na sala: do LiveKit dentro da chamada, da API fora dela. São dois componentes porque o
 * `useLiveMembers` só funciona dentro da sala conectada.
 */
function VoiceChannel(props: RowProps) {
	const { room, voiceChannelId } = useVoice();
	const inCall = voiceChannelId === props.channel.id;
	return room && inCall ? (
		<LiveVoiceChannel {...props} />
	) : (
		<ApiVoiceChannel {...props} inCall={inCall} />
	);
}

function LiveVoiceChannel(props: RowProps) {
	const live = useLiveMembers();
	// O que cada um transmite vem da API (o app de quem transmite conta), não do LiveKit.
	const { data } = useVoiceParticipants(props.channel.id, { enabled: false });
	const shares = new Map(
		(data ?? []).flatMap((participant) => {
			const share = memberFromApi(participant).share;
			return share ? [[participant.user_id, share] as const] : [];
		}),
	);
	const members = live.map((member) =>
		member.sharing && shares.has(member.id)
			? { ...member, share: shares.get(member.id) }
			: member,
	);
	return <VoiceChannelRow {...props} members={members} inCall />;
}

function ApiVoiceChannel({ inCall, ...props }: RowProps & { inCall: boolean }) {
	// Entrando na chamada, para de perguntar e fica com a última lista até o LiveKit responder.
	const { data } = useVoiceParticipants(props.channel.id, { enabled: !inCall });
	return (
		<VoiceChannelRow
			{...props}
			members={data?.map(memberFromApi) ?? []}
			inCall={inCall}
		/>
	);
}

function VoiceChannelRow({
	channel,
	collapsed,
	manage,
	members: unordered,
	inCall,
}: RowProps & { members: ChannelMember[]; inCall: boolean }) {
	// Quem transmite sobe para o topo da lista, o mais recente primeiro.
	const members = sharingFirst(unordered);
	const session = useSession();
	const myId = session.status === "connected" ? session.user.id : null;
	const { join } = useVoice();
	const { guard, dialog } = useGuardedJoin();
	const navigate = useNavigate();
	const drop = useRoomDrop(channel);
	const onRoom = useMatch(paths.voiceRoom) !== null;
	// A sala fica marcada só na tela da chamada: a do servidor agora é o canal de texto.
	const selected = inCall && onRoom;
	const shown =
		!collapsed ||
		shownWhenCollapsed(channel, {
			openChannelId: null,
			currentRoomId: inCall ? channel.id : null,
			people: members.length,
		});
	if (!shown) return null;

	function openRoom() {
		if (inCall) {
			if (!onRoom) void navigate(paths.voiceRoom);
			return;
		}
		// Numa ligação privada, entrar na sala encerra a ligação: pergunta antes.
		guard(channel.name, () => {
			join(channel.id);
			void navigate(paths.voiceRoom);
		});
	}

	return (
		<li
			ref={drop.setNodeRef}
			className={cn(drop.highlighted && "rounded-md bg-selected/40")}
		>
			<RowFrame channel={channel} manage={manage}>
				<button
					type="button"
					aria-label={
						inCall ? `Abrir a ${channel.name}` : `Entrar na ${channel.name}`
					}
					aria-current={selected ? "page" : undefined}
					onClick={openRoom}
					className={rowClass(selected)}
				>
					<Volume2Icon aria-hidden="true" className="size-[18px] shrink-0" />
					<span className="truncate">{channel.name}</span>
					<RestrictedMark channel={channel} />
					{collapsed ? (
						<AvatarStrip members={members} />
					) : (
						members.length > 0 && (
							<span className="ml-auto font-mono text-[11px] font-normal text-secondary-foreground">
								{members.length}
							</span>
						)
					)}
				</button>
			</RowFrame>
			{dialog}
			{!collapsed && members.length > 0 && (
				<RoomMembers
					members={members}
					myId={myId}
					roomId={channel.id}
					roomName={channel.name}
					inCall={inCall}
				/>
			)}
		</li>
	);
}

/** O cadeado do canal restrito (ADR 0028): só quem está na lista e quem gerencia o veem. */
function RestrictedMark({ channel }: { channel: ChannelView }) {
	if (!channel.restricted) return null;
	return (
		<>
			<LockIcon
				aria-hidden="true"
				className="size-3 shrink-0 text-muted-foreground"
			/>
			<span className="sr-only">, restrito</span>
		</>
	);
}
