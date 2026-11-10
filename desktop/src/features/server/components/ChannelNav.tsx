import {
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	ArchiveIcon,
	ArrowDownIcon,
	ArrowUpIcon,
	ChevronDownIcon,
	EllipsisIcon,
	FolderPlusIcon,
	GripVerticalIcon,
	HashIcon,
	HeadphoneOffIcon,
	MicOffIcon,
	PencilIcon,
	PlusIcon,
	Volume2Icon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	applyDrop,
	COLLAPSED_AVATARS,
	canArchive,
	dragCollision,
	dragId,
	moveCategory,
	moveChannel,
	openChannelDialog,
	sameOrder,
	shownWhenCollapsed,
	toggleCategory,
	useCanManageChannels,
	useChannelLayout,
	useIsCollapsed,
	useSetLayout,
} from "@/features/channels";
import { Avatar, useSession } from "@/features/identity";
import {
	type ChannelMember,
	LiveBadge,
	memberFromApi,
	PersonCard,
	useLiveMembers,
	useVoice,
	useVoiceParticipants,
} from "@/features/voice";
import type { CategoryView, ChannelView, Layout } from "@/lib/api";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";

/*
 * A coluna do servidor (ADR 0016): os canais do topo e as categorias, cada uma com os seus canais
 * de texto e salas de voz. Clicar num canal de texto abre a conversa; clicar numa sala entra na
 * chamada (quem já está nela só volta para a chamada).
 *
 * A categoria recolhe pelo nome (fica neste computador). Recolhida, ainda mostra o canal aberto, a
 * sala em que a pessoa está e as salas com gente, só com os avatares.
 *
 * Quem gerencia os canais (`can_manage_channels`) vê o menu "…" de cada canal e categoria, o "+" de
 * criar canal na categoria, e arrasta pela alça (ou pelo teclado: foco na alça, Espaço, setas,
 * Espaço). "Mover para cima/baixo" no menu faz o mesmo sem arrastar.
 */
export function ChannelNav() {
	const { data: layout } = useChannelLayout();
	const canManage = useCanManageChannels();
	const setLayout = useSetLayout();
	const sensors = useSensors(
		// Um clique não vira arrasto: só depois de 6 px.
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	if (!layout) return <div className="min-h-0 flex-1" />;

	function save(next: Layout | null) {
		// Com uma ordem ainda sendo gravada, a seguinte sairia com a versão velha e levaria 409,
		// mesmo sem ninguém ter mexido.
		if (setLayout.isPending) return;
		if (layout && next && !sameOrder(layout, next)) setLayout.mutate(next);
	}

	function onDragEnd({ active, over }: DragEndEvent) {
		if (!layout || !over) return;
		save(applyDrop(layout, String(active.id), String(over.id)));
	}

	const actions: TreeActions = {
		canManage,
		moveChannel: (id, step) => layout && save(moveChannel(layout, id, step)),
		moveCategory: (id, step) => layout && save(moveCategory(layout, id, step)),
	};

	return (
		<nav
			aria-label="Canais"
			className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-2 pb-2"
		>
			<DndContext
				sensors={sensors}
				collisionDetection={dragCollision}
				onDragEnd={onDragEnd}
				accessibility={{ screenReaderInstructions: { draggable: DRAG_HELP } }}
			>
				<TopChannels channels={layout.top} actions={actions} />
				<SortableContext
					items={layout.categories.map((c) => dragId.category(c.id))}
					strategy={verticalListSortingStrategy}
				>
					{layout.categories.map((category) => (
						<CategorySection
							key={category.id}
							category={category}
							actions={actions}
						/>
					))}
				</SortableContext>
			</DndContext>
			{canManage && (
				<div className="mt-3 flex flex-col gap-0.5 px-2">
					<NavButton
						icon={<PlusIcon />}
						onClick={() =>
							openChannelDialog({ kind: "createChannel", categoryId: null })
						}
					>
						Criar canal
					</NavButton>
					<NavButton
						icon={<FolderPlusIcon />}
						onClick={() => openChannelDialog({ kind: "createCategory" })}
					>
						Criar categoria
					</NavButton>
				</div>
			)}
		</nav>
	);
}

const DRAG_HELP =
	"Para mover, aperte Espaço, use as setas para cima e para baixo e aperte Espaço de novo para soltar. Esc cancela.";

interface TreeActions {
	canManage: boolean;
	moveChannel: (id: string, step: -1 | 1) => void;
	moveCategory: (id: string, step: -1 | 1) => void;
}

function NavButton({
	icon,
	onClick,
	children,
}: {
	icon: ReactNode;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-secondary hover:text-foreground [&>svg]:size-4"
		>
			{icon}
			{children}
		</button>
	);
}

function TopChannels({
	channels,
	actions,
}: {
	channels: ChannelView[];
	actions: TreeActions;
}) {
	// O topo também recebe canais soltos no fim dele (tirar da categoria).
	const { setNodeRef } = useDroppable({
		id: dragId.top,
		disabled: !actions.canManage,
	});
	return (
		<SortableContext
			items={channels.map((c) => dragId.channel(c.id))}
			strategy={verticalListSortingStrategy}
		>
			<ul
				ref={setNodeRef}
				aria-label="Canais fora de categoria"
				className="flex min-h-1 flex-col gap-0.5"
			>
				{channels.map((channel) => (
					<ChannelItem
						key={channel.id}
						channel={channel}
						collapsed={false}
						actions={actions}
					/>
				))}
			</ul>
		</SortableContext>
	);
}

function CategorySection({
	category,
	actions,
}: {
	category: CategoryView;
	actions: TreeActions;
}) {
	const collapsed = useIsCollapsed(category.id);
	const sortable = useSortable({
		id: dragId.category(category.id),
		disabled: !actions.canManage,
	});
	const listId = `categoria-${category.id}`;

	return (
		<section
			ref={sortable.setNodeRef}
			aria-label={category.name}
			style={{
				transform: CSS.Translate.toString(sortable.transform),
				transition: sortable.transition,
			}}
			className={cn("pt-3", sortable.isDragging && "relative z-10 opacity-80")}
		>
			<div className="group/category relative flex items-center gap-1 pt-1 pr-3 pb-1 pl-4">
				{actions.canManage && (
					<DragHandle
						label={`Mover a categoria ${category.name}`}
						sortable={sortable}
						className="absolute top-1/2 left-0.5 -translate-y-1/2"
					/>
				)}
				<button
					type="button"
					aria-expanded={!collapsed}
					aria-controls={listId}
					onClick={() => toggleCategory(category.id)}
					className="flex min-w-0 flex-1 items-center gap-1 text-[11px] font-bold tracking-[0.06em] text-muted-foreground uppercase hover:text-foreground"
				>
					<ChevronDownIcon
						aria-hidden="true"
						className={cn(
							"size-3 shrink-0 transition-transform",
							collapsed && "-rotate-90",
						)}
					/>
					<span className="truncate">{category.name}</span>
				</button>
				{actions.canManage && (
					<>
						<button
							type="button"
							aria-label={`Criar canal em ${category.name}`}
							onClick={() =>
								openChannelDialog({
									kind: "createChannel",
									categoryId: category.id,
								})
							}
							className="flex rounded text-muted-foreground hover:text-foreground"
						>
							<PlusIcon className="size-4" strokeWidth={2.25} />
						</button>
						<CategoryMenu category={category} actions={actions} />
					</>
				)}
			</div>
			<SortableContext
				items={category.channels.map((c) => dragId.channel(c.id))}
				strategy={verticalListSortingStrategy}
			>
				<ul id={listId} className="flex flex-col gap-0.5">
					{category.channels.map((channel) => (
						<ChannelItem
							key={channel.id}
							channel={channel}
							collapsed={collapsed}
							actions={actions}
						/>
					))}
				</ul>
			</SortableContext>
		</section>
	);
}

/** A alça de arrastar: fica na margem à esquerda e só aparece com o mouse em cima ou no foco. */
function DragHandle({
	label,
	sortable,
	className,
}: {
	label: string;
	sortable: ReturnType<typeof useSortable>;
	className?: string;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			ref={sortable.setActivatorNodeRef}
			{...sortable.attributes}
			{...sortable.listeners}
			className={cn(
				"z-10 flex w-3 shrink-0 cursor-grab touch-none justify-center rounded text-muted-foreground opacity-0 group-hover/category:opacity-100 group-hover/channel:opacity-100 hover:text-foreground focus-visible:opacity-100 active:cursor-grabbing",
				className,
			)}
		>
			<GripVerticalIcon aria-hidden="true" className="size-3" />
		</button>
	);
}

function MenuTrigger({
	label,
	className,
}: {
	label: string;
	className?: string;
}) {
	return (
		<DropdownMenuTrigger
			render={
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={label}
					className={cn(
						"size-6 text-muted-foreground opacity-0 group-hover/category:opacity-100 group-hover/channel:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100",
						className,
					)}
				/>
			}
		>
			<EllipsisIcon className="size-4" />
		</DropdownMenuTrigger>
	);
}

function CategoryMenu({
	category,
	actions,
}: {
	category: CategoryView;
	actions: TreeActions;
}) {
	return (
		<DropdownMenu>
			<MenuTrigger label={`Mais ações para a categoria ${category.name}`} />
			<DropdownMenuContent
				aria-label={`Ações para a categoria ${category.name}`}
			>
				<DropdownMenuItem
					onClick={() =>
						openChannelDialog({
							kind: "createChannel",
							categoryId: category.id,
						})
					}
				>
					<PlusIcon className="size-[15px]" />
					Criar canal aqui
				</DropdownMenuItem>
				<DropdownMenuItem
					onClick={() =>
						openChannelDialog({ kind: "renameCategory", category })
					}
				>
					<PencilIcon className="size-[15px]" />
					Renomear
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => actions.moveCategory(category.id, -1)}>
					<ArrowUpIcon className="size-[15px]" />
					Mover para cima
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => actions.moveCategory(category.id, 1)}>
					<ArrowDownIcon className="size-[15px]" />
					Mover para baixo
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onClick={() =>
						openChannelDialog({ kind: "archiveCategory", category })
					}
				>
					<ArchiveIcon className="size-[15px]" />
					Arquivar categoria
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ChannelMenu({
	channel,
	actions,
}: {
	channel: ChannelView;
	actions: TreeActions;
}) {
	const label = channel.kind === "text" ? `#${channel.name}` : channel.name;
	return (
		<DropdownMenu>
			<MenuTrigger label={`Mais ações para ${label}`} className="mr-1" />
			<DropdownMenuContent aria-label={`Ações para ${label}`}>
				<DropdownMenuItem
					onClick={() => openChannelDialog({ kind: "editChannel", channel })}
				>
					<PencilIcon className="size-[15px]" />
					{channel.kind === "text" ? "Editar canal" : "Renomear sala"}
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => actions.moveChannel(channel.id, -1)}>
					<ArrowUpIcon className="size-[15px]" />
					Mover para cima
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => actions.moveChannel(channel.id, 1)}>
					<ArrowDownIcon className="size-[15px]" />
					Mover para baixo
				</DropdownMenuItem>
				{canArchive(channel) && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onClick={() =>
								openChannelDialog({ kind: "archiveChannel", channel })
							}
						>
							<ArchiveIcon className="size-[15px]" />
							Arquivar canal
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** Um canal na árvore, com a alça e o menu para quem gerencia. */
function ChannelItem({
	channel,
	collapsed,
	actions,
}: {
	channel: ChannelView;
	collapsed: boolean;
	actions: TreeActions;
}) {
	const sortable = useSortable({
		id: dragId.channel(channel.id),
		disabled: !actions.canManage,
	});
	const style = {
		transform: CSS.Translate.toString(sortable.transform),
		transition: sortable.transition,
	};
	const tools = actions.canManage && (
		<ChannelMenu channel={channel} actions={actions} />
	);
	const handle = actions.canManage && (
		<DragHandle
			label={`Mover ${channel.kind === "text" ? `#${channel.name}` : channel.name}`}
			sortable={sortable}
			className="absolute top-1/2 -left-2 -translate-y-1/2"
		/>
	);
	const props = {
		channel,
		collapsed,
		handle,
		tools,
		innerRef: sortable.setNodeRef,
		style,
		dragging: sortable.isDragging,
	};
	return channel.kind === "text" ? (
		<TextChannel {...props} />
	) : (
		<VoiceChannel {...props} />
	);
}

interface RowProps {
	channel: ChannelView;
	collapsed: boolean;
	handle: ReactNode;
	tools: ReactNode;
	innerRef: (node: HTMLElement | null) => void;
	style: React.CSSProperties;
	dragging: boolean;
}

const rowClass = (selected: boolean) =>
	cn(
		"flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
		selected
			? "bg-selected font-semibold text-selected-foreground"
			: "font-normal text-muted-foreground hover:bg-secondary hover:text-foreground",
	);

function TextChannel({
	channel,
	collapsed,
	handle,
	tools,
	innerRef,
	style,
	dragging,
}: RowProps) {
	const navigate = useNavigate();
	const match = useMatch(paths.channelPattern);
	const selected = match?.params.channelId === channel.id;
	const shown =
		!collapsed ||
		shownWhenCollapsed(channel, {
			openChannelId: match?.params.channelId ?? null,
			currentRoomId: null,
			people: 0,
		});
	if (!shown) return null;
	return (
		<li
			ref={innerRef}
			style={style}
			className={cn(
				"group/channel relative mx-2 flex items-center",
				dragging && "z-10 opacity-80",
			)}
		>
			{handle}
			<button
				type="button"
				aria-current={selected ? "page" : undefined}
				onClick={() => void navigate(paths.channel(channel.id))}
				className={rowClass(selected)}
			>
				<HashIcon aria-hidden="true" className="size-[18px] shrink-0" />
				<span className="truncate">{channel.name}</span>
			</button>
			{tools}
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
	handle,
	tools,
	innerRef,
	style,
	dragging,
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
		<li
			ref={innerRef}
			style={style}
			className={cn(dragging && "relative z-10 opacity-80")}
		>
			<div className="group/channel relative mx-2 flex items-center">
				{handle}
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
				{tools}
			</div>
			{!collapsed && members.length > 0 && (
				<ul
					aria-label={`Quem está na ${channel.name}`}
					className="flex flex-col gap-0.5"
				>
					{members.map((member) => (
						<li key={member.id}>
							<MemberRow
								member={member}
								isMe={member.id === myId}
								roomName={channel.name}
							/>
						</li>
					))}
				</ul>
			)}
		</li>
	);
}

/** Recolhida: até 5 avatares, "+N" para o resto e o selo de quem transmite. */
function AvatarStrip({ members }: { members: ChannelMember[] }) {
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
