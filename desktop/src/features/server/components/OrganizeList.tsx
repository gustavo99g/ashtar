import {
	DndContext,
	type DragEndEvent,
	DragOverlay,
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
import { GripVerticalIcon, HashIcon, Volume2Icon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	type DropLine,
	dragCollision,
	dragId,
	dropInDraft,
	dropLine,
	organizeChanged,
	parseDragId,
	stopOrganizing,
	useFinishOrganizing,
	useOrganize,
} from "@/features/channels";
import type { CategoryView, ChannelView } from "@/lib/api";
import { cn } from "@/lib/utils";
import { channelLabel } from "./ChannelMenu";

/*
 * A coluna no modo Organizar (ADR 0020), no lugar da lista de sempre. Mostra a cópia da árvore que
 * está no `organizeStore`: toda linha vira uma caixa com a alça, e arrastar mexe só na cópia. A
 * faixa do alto tem o Desfazer (joga a cópia fora) e o Concluir (grava tudo num pedido só).
 *
 * As linhas não saem do lugar durante o arrasto. O que mostra o destino é a linha azul
 * (`dropLine`), a origem fica tracejada e apagada, e a cópia levantada segue o mouse
 * (`DragOverlay`). Pelo teclado: foco na alça, Espaço, setas e Espaço de novo; Esc cancela o
 * arrasto.
 *
 * Aqui nenhuma linha navega nem abre menu, as categorias aparecem abertas e ninguém da sala é
 * listado: o modo é só para a ordem.
 */

const DRAG_HELP =
	"Para mover, aperte Espaço, use as setas para cima e para baixo e aperte Espaço de novo para soltar. Esc cancela.";

export function OrganizeList() {
	const draft = useOrganize((state) => state.draft);
	const changed = useOrganize(organizeChanged);
	const { finish, isPending } = useFinishOrganizing();
	const [activeId, setActiveId] = useState<string | null>(null);
	const [overId, setOverId] = useState<string | null>(null);
	const sensors = useSensors(
		// Um clique não vira arrasto: só depois de 6 px.
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	if (!draft) return null;

	const line = activeId && overId ? dropLine(draft, activeId, overId) : null;
	const active = activeId ? parseDragId(activeId) : null;
	const drag: DragState = { activeId, line, category: active?.kind === "category" };

	function endDrag() {
		setActiveId(null);
		setOverId(null);
	}

	function onDragEnd({ active, over }: DragEndEvent) {
		if (over) dropInDraft(String(active.id), String(over.id));
		endDrag();
	}

	return (
		<nav
			aria-label="Canais"
			className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-1 pb-2"
		>
			<section
				aria-label="Organizando canais"
				className="mx-2 my-1.5 flex flex-col gap-2 rounded-[10px] border border-border-strong bg-info-subtle/50 p-2.5"
			>
				<p className="text-[12.5px] leading-[1.45] text-secondary-foreground">
					<strong className="text-foreground">Organizando canais.</strong>{" "}
					Arraste pela alça para mudar a ordem ou levar para outra categoria.
				</p>
				<div className="flex gap-1.5">
					<Button
						variant="secondary"
						size="sm"
						className="flex-1"
						disabled={isPending}
						onClick={stopOrganizing}
					>
						Desfazer
					</Button>
					<Button
						size="sm"
						className="flex-1"
						disabled={isPending}
						onClick={finish}
					>
						{isPending ? "Gravando…" : "Concluir"}
					</Button>
				</div>
				<span className="sr-only" role="status">
					{changed ? "Há mudanças na ordem que ainda não foram gravadas." : ""}
				</span>
			</section>
			<DndContext
				sensors={sensors}
				collisionDetection={dragCollision}
				onDragStart={({ active }) => setActiveId(String(active.id))}
				onDragOver={({ over }) => setOverId(over ? String(over.id) : null)}
				onDragEnd={onDragEnd}
				onDragCancel={endDrag}
				accessibility={{ screenReaderInstructions: { draggable: DRAG_HELP } }}
			>
				<TopChannels channels={draft.top} drag={drag} />
				<SortableContext
					items={draft.categories.map((c) => dragId.category(c.id))}
					strategy={verticalListSortingStrategy}
				>
					{draft.categories.map((category) => (
						<OrganizeCategory key={category.id} category={category} drag={drag} />
					))}
				</SortableContext>
				<DragOverlay dropAnimation={null}>
					{active && <Lifted target={active} draft={draft} />}
				</DragOverlay>
			</DndContext>
		</nav>
	);
}

/** O arrasto em andamento, para as linhas saberem o que desenhar. */
interface DragState {
	activeId: string | null;
	line: DropLine | null;
	/** O que está sendo arrastado é uma categoria. */
	category: boolean;
}

/** A borda em que a linha azul aparece nesta linha, se for nela. */
function edgeFor(drag: DragState, id: string): DropLine["edge"] | null {
	return drag.line?.id === id ? drag.line.edge : null;
}

/** A linha azul de "vai cair aqui", por cima da borda de quem a recebe. */
function DropMark({ edge }: { edge: DropLine["edge"] | null }) {
	if (!edge) return null;
	return (
		<span
			aria-hidden="true"
			data-drop-line={edge}
			className={cn(
				"pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-primary",
				"before:absolute before:-top-[3px] before:-left-[3px] before:size-2 before:rounded-full before:bg-primary",
				edge === "before" ? "-top-0.5" : "-bottom-0.5",
			)}
		/>
	);
}

const boxClass =
	"flex h-8 items-center gap-2 rounded-md border border-border-strong bg-secondary px-2 text-sm text-secondary-foreground";
const headerClass =
	"flex h-[30px] items-center gap-1.5 rounded-md border border-dashed border-border-strong bg-secondary/60 px-2 text-[11px] font-bold tracking-[0.06em] text-muted-foreground uppercase";

function Handle({
	label,
	sortable,
}: {
	label: string;
	sortable: ReturnType<typeof useSortable>;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			ref={sortable.setActivatorNodeRef}
			{...sortable.attributes}
			{...sortable.listeners}
			className="flex shrink-0 cursor-grab touch-none rounded text-foreground-subtle hover:text-foreground active:cursor-grabbing"
		>
			<GripVerticalIcon aria-hidden="true" className="size-3.5" />
		</button>
	);
}

function ChannelIcon({ channel }: { channel: ChannelView }) {
	const Icon = channel.kind === "text" ? HashIcon : Volume2Icon;
	return (
		<Icon
			aria-hidden="true"
			className="size-4 shrink-0 text-muted-foreground"
		/>
	);
}

function TopChannels({
	channels,
	drag,
}: {
	channels: ChannelView[];
	drag: DragState;
}) {
	// O topo também recebe canais soltos no fim dele (tirar da categoria).
	const { setNodeRef } = useDroppable({ id: dragId.top });
	return (
		<ChannelList
			label="Canais fora de categoria"
			channels={channels}
			drag={drag}
			innerRef={setNodeRef}
			// Vazio, ainda precisa de altura para receber um canal.
			className="min-h-3"
		>
			{!drag.category && <DropMark edge={edgeFor(drag, dragId.top)} />}
		</ChannelList>
	);
}

function ChannelList({
	label,
	channels,
	drag,
	innerRef,
	className,
	children,
}: {
	label?: string;
	channels: ChannelView[];
	drag: DragState;
	innerRef?: (node: HTMLElement | null) => void;
	className?: string;
	children?: ReactNode;
}) {
	return (
		<SortableContext
			items={channels.map((c) => dragId.channel(c.id))}
			strategy={verticalListSortingStrategy}
		>
			<ul
				ref={innerRef}
				aria-label={label}
				className={cn("relative mx-2 flex flex-col gap-0.5", className)}
			>
				{channels.map((channel) => (
					<OrganizeChannel key={channel.id} channel={channel} drag={drag} />
				))}
				{children}
			</ul>
		</SortableContext>
	);
}

function OrganizeChannel({
	channel,
	drag,
}: {
	channel: ChannelView;
	drag: DragState;
}) {
	const id = dragId.channel(channel.id);
	const sortable = useSortable({ id });
	return (
		<li ref={sortable.setNodeRef} className="relative">
			<div
				className={cn(
					boxClass,
					sortable.isDragging && "border-dashed bg-transparent opacity-40",
				)}
			>
				<Handle label={`Mover ${channelLabel(channel)}`} sortable={sortable} />
				<ChannelIcon channel={channel} />
				<span className="truncate">{channel.name}</span>
			</div>
			<DropMark edge={edgeFor(drag, id)} />
		</li>
	);
}

function OrganizeCategory({
	category,
	drag,
}: {
	category: CategoryView;
	drag: DragState;
}) {
	const id = dragId.category(category.id);
	// O alvo é o nome da categoria, e não a seção inteira: soltar um canal nele leva para o fim dela.
	const sortable = useSortable({ id });
	const edge = edgeFor(drag, id);
	return (
		<section
			aria-label={category.name}
			className={cn("relative pt-2.5", sortable.isDragging && "opacity-40")}
		>
			{/* Arrastando uma categoria, a linha fica em volta da seção inteira. */}
			{drag.category && <DropMark edge={edge} />}
			<div ref={sortable.setNodeRef} className="relative mx-2 mb-0.5">
				<div className={headerClass}>
					<Handle
						label={`Mover a categoria ${category.name}`}
						sortable={sortable}
					/>
					<span className="truncate">{category.name}</span>
				</div>
				{/* Arrastando um canal para uma categoria vazia, logo abaixo do nome. */}
				{!drag.category && <DropMark edge={edge} />}
			</div>
			<ChannelList channels={category.channels} drag={drag} />
		</section>
	);
}

/** A cópia levantada que segue o mouse. */
function Lifted({
	target,
	draft,
}: {
	target: NonNullable<ReturnType<typeof parseDragId>>;
	draft: { top: ChannelView[]; categories: CategoryView[] };
}) {
	const lifted =
		"translate-x-1.5 -rotate-1 border-solid border-primary bg-secondary-hover shadow-[0_10px_24px_rgba(0,0,0,0.5)]";
	if (target.kind === "category") {
		const category = draft.categories.find((c) => c.id === target.id);
		if (!category) return null;
		return (
			<div className={cn(headerClass, lifted)}>
				<GripVerticalIcon aria-hidden="true" className="size-3.5 shrink-0" />
				<span className="truncate">{category.name}</span>
			</div>
		);
	}
	if (target.kind !== "channel") return null;
	const channel = [
		...draft.top,
		...draft.categories.flatMap((c) => c.channels),
	].find((c) => c.id === target.id);
	if (!channel) return null;
	return (
		<div className={cn(boxClass, lifted)}>
			<GripVerticalIcon
				aria-hidden="true"
				className="size-3.5 shrink-0 text-foreground-subtle"
			/>
			<ChannelIcon channel={channel} />
			<span className="truncate">{channel.name}</span>
		</div>
	);
}
