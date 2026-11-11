import { ChevronDownIcon, PlusIcon } from "lucide-react";
import { type MouseEvent, useRef, useState } from "react";
import { useMatch } from "react-router-dom";
import {
	openChannelDialog,
	toggleCategory,
	useIsCollapsed,
} from "@/features/channels";
import { useUnreadStore } from "@/features/unread";
import type { CategoryView } from "@/lib/api";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { CategoryMenu } from "./ChannelMenu";
import { type ChannelManage, ChannelRow } from "./ChannelRow";

/*
 * Uma categoria da coluna (ADR 0020): o nome, que recolhe e abre os canais dela (a seta fica para
 * o lado quando recolhida), e os canais. Para quem gerencia, o + de criar canal aparece por cima da
 * linha, só com o mouse nela ou com o foco, e o botão direito no nome abre Renomear e Arquivar.
 *
 * Recolhida, se esconde um canal de texto com não lidas, ganha um ponto ao lado do nome.
 */
export function CategoryRow({
	category,
	manage,
}: {
	category: CategoryView;
	manage: ChannelManage | null;
}) {
	const collapsed = useIsCollapsed(category.id);
	const [menuOpen, setMenuOpen] = useState(false);
	const nameRef = useRef<HTMLButtonElement>(null);
	const listId = `categoria-${category.id}`;
	const openChannelId = useMatch(paths.channelPattern)?.params.channelId;
	const hidesUnread = useUnreadStore(
		(store) =>
			collapsed &&
			category.channels.some(
				(channel) =>
					channel.kind === "text" &&
					channel.id !== openChannelId &&
					(store.byChannel[channel.id]?.unread ?? 0) > 0,
			),
	);

	function onContextMenu(event: MouseEvent) {
		if (!manage) return;
		event.preventDefault();
		setMenuOpen(true);
	}

	return (
		<section aria-label={category.name} className="pt-3">
			<div className="group/category relative flex items-center pt-1 pr-3 pb-1 pl-4">
				<button
					ref={nameRef}
					type="button"
					aria-expanded={!collapsed}
					aria-controls={listId}
					onClick={() => toggleCategory(category.id)}
					onContextMenu={onContextMenu}
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
					{hidesUnread && (
						<>
							<span
								aria-hidden="true"
								className="ml-1 size-1.5 shrink-0 rounded-full bg-foreground"
							/>
							<span className="sr-only">, com mensagens novas</span>
						</>
					)}
				</button>
				{manage && (
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
							className="absolute top-1/2 right-3 flex -translate-y-1/2 rounded bg-card text-muted-foreground opacity-0 group-hover/category:opacity-100 hover:text-foreground focus-visible:opacity-100"
						>
							<PlusIcon aria-hidden="true" className="size-4" strokeWidth={2.25} />
						</button>
						<CategoryMenu
							category={category}
							anchor={nameRef}
							open={menuOpen}
							onOpenChange={setMenuOpen}
						/>
					</>
				)}
			</div>
			<ul id={listId} className="flex flex-col gap-0.5">
				{category.channels.map((channel) => (
					<ChannelRow
						key={channel.id}
						channel={channel}
						collapsed={collapsed}
						manage={manage}
					/>
				))}
			</ul>
		</section>
	);
}
