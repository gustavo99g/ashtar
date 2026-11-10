import {
	ArchiveIcon,
	CheckIcon,
	FolderInputIcon,
	PencilIcon,
	SettingsIcon,
} from "lucide-react";
import type { RefObject } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { canArchive, openChannelDialog } from "@/features/channels";
import type { CategoryView, ChannelView } from "@/lib/api";

/*
 * Os menus de quem gerencia os canais (ADR 0020).
 *
 * O do canal abre pela engrenagem, que só aparece com o mouse na linha ou com o foco, e pelo botão
 * direito na linha (quem manda abrir é a linha, pelo `open`). O da categoria não tem botão: só o
 * botão direito no nome dela (ou Shift + F10, com o foco nele).
 */

/** O `#nome` do canal de texto, ou o nome da sala. */
export function channelLabel(channel: ChannelView): string {
	return channel.kind === "text" ? `#${channel.name}` : channel.name;
}

export function ChannelMenu({
	channel,
	categories,
	open,
	onOpenChange,
	onMoveTo,
}: {
	channel: ChannelView;
	/** As categorias abertas, na ordem da lista: os destinos do "Mover para". */
	categories: CategoryView[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** `null` é "Sem categoria", o topo da lista. */
	onMoveTo: (categoryId: string | null) => void;
}) {
	const label = channelLabel(channel);
	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<DropdownMenuTrigger
				aria-label={`Ações para ${label}`}
				className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
			>
				<SettingsIcon aria-hidden="true" className="size-4" />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				aria-label={`Ações para ${label}`}
				className="w-[210px]"
			>
				<DropdownMenuItem
					onClick={() => openChannelDialog({ kind: "editChannel", channel })}
				>
					<PencilIcon className="size-[15px]" />
					{channel.kind === "text" ? "Editar canal" : "Renomear sala"}
				</DropdownMenuItem>
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>
						<FolderInputIcon className="size-[15px]" />
						Mover para
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent aria-label="Mover para">
						<MoveTarget
							name="Sem categoria"
							current={channel.category_id === null}
							onClick={() => onMoveTo(null)}
						/>
						{categories.map((category) => (
							<MoveTarget
								key={category.id}
								name={category.name}
								current={channel.category_id === category.id}
								onClick={() => onMoveTo(category.id)}
							/>
						))}
					</DropdownMenuSubContent>
				</DropdownMenuSub>
				{canArchive(channel) && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							variant="danger"
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

/** Um destino do "Mover para". O lugar em que o canal já está vem marcado e não faz nada. */
function MoveTarget({
	name,
	current,
	onClick,
}: {
	name: string;
	current: boolean;
	onClick: () => void;
}) {
	return (
		<DropdownMenuItem
			aria-current={current ? "true" : undefined}
			onClick={current ? undefined : onClick}
		>
			<span className="flex w-4 shrink-0 text-primary">
				{current && <CheckIcon aria-hidden="true" className="size-4" />}
			</span>
			<span className="truncate">{name}</span>
		</DropdownMenuItem>
	);
}

export function CategoryMenu({
	category,
	anchor,
	open,
	onOpenChange,
}: {
	category: CategoryView;
	/** O nome da categoria: o menu abre encostado nele. */
	anchor: RefObject<HTMLElement | null>;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<DropdownMenuContent
				anchor={anchor}
				align="start"
				aria-label={`Ações para a categoria ${category.name}`}
				className="w-[210px]"
			>
				<DropdownMenuItem
					onClick={() =>
						openChannelDialog({ kind: "renameCategory", category })
					}
				>
					<PencilIcon className="size-[15px]" />
					Renomear categoria
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					variant="danger"
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
