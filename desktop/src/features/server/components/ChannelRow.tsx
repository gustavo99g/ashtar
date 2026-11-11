import { HashIcon, Volume2Icon } from "lucide-react";
import { type MouseEvent, type ReactNode, useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { shownWhenCollapsed } from "@/features/channels";
import { useReadState } from "@/features/unread";
import { useSession } from "@/features/identity";
import {
	type ChannelMember,
	memberFromApi,
	useLiveMembers,
	useVoice,
	useVoiceParticipants,
} from "@/features/voice";
import type { CategoryView, ChannelView } from "@/lib/api";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { ChannelMenu } from "./ChannelMenu";
import { AvatarStrip, RoomMembers } from "./RoomMembers";

/*
 * Uma linha de canal na coluna (ADR 0020). A linha não reserva espaço para ferramenta nenhuma: a
 * engrenagem aparece por cima dela, à direita, só com o mouse na linha, com o foco ou com o menu
 * aberto. O botão direito na linha abre o mesmo menu. No canal de texto ela é de todo mundo (o
 * "Marcar como lido"); na sala de voz, só de quem gerencia.
 *
 * O canal de texto com não lidas fica com o nome em destaque e um ponto na beirada esquerda.
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
	// No canal aberto as novas são lidas na hora: não precisa chamar atenção.
	const fresh = useReadState(channel.id).unread > 0 && !selected;
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
					{fresh && <span className="sr-only">, com mensagens novas</span>}
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
	return <VoiceChannelRow {...props} members={useLiveMembers()} inCall />;
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
	members,
	inCall,
}: RowProps & { members: ChannelMember[]; inCall: boolean }) {
	const session = useSession();
	const myId = session.status === "connected" ? session.user.id : null;
	const { join } = useVoice();
	const navigate = useNavigate();
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
		if (!inCall) join(channel.id);
		if (!onRoom) void navigate(paths.voiceRoom);
	}

	return (
		<li>
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
			{!collapsed && members.length > 0 && (
				<RoomMembers
					members={members}
					myId={myId}
					roomName={channel.name}
					inCall={inCall}
				/>
			)}
		</li>
	);
}
