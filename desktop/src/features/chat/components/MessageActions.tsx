import {
	CopyIcon,
	MoreHorizontalIcon,
	PencilIcon,
	ReplyIcon,
	Trash2Icon,
} from "lucide-react";
import type { MouseEvent } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Message } from "@/lib/api";
import {
	canDelete,
	canEdit,
	type MessageActionsValue,
	QUICK_REACTIONS,
} from "./messageContext";

/** Se quem lê já reagiu com `emoji`. */
export function reacted(
	message: Message,
	emoji: string,
	myId: string | null,
): boolean {
	return (
		myId !== null &&
		(message.reactions
			.find((r) => r.emoji === emoji)
			?.users.includes(myId) ??
			false)
	);
}

/**
 * Os itens do menu da mensagem, iguais no "..." da barra e no botão direito: as reações rápidas (só
 * no botão direito, que não tem a barra), Responder, Editar, Copiar texto e Excluir. Segurar Shift
 * ao clicar em Excluir pula a confirmação.
 */
export function MessageMenuItems({
	message,
	actions,
	withReactions,
}: {
	message: Message;
	actions: MessageActionsValue;
	withReactions: boolean;
}) {
	const { myId } = actions;
	const deletable = canDelete(message, myId, actions.canModerate);
	return (
		<>
			{withReactions && (
				<div className="flex justify-between px-1 pt-1 pb-2">
					{QUICK_REACTIONS.map(({ emoji, label }) => (
						<DropdownMenuItem
							key={emoji}
							aria-label={`Reagir com ${label}`}
							onClick={() =>
								actions.react(message, emoji, !reacted(message, emoji, myId))
							}
							className="size-9 justify-center rounded-full bg-secondary p-0 text-[17px]"
						>
							{emoji}
						</DropdownMenuItem>
					))}
				</div>
			)}
			<DropdownMenuItem onClick={() => actions.reply(message)}>
				<ReplyIcon />
				Responder
			</DropdownMenuItem>
			{canEdit(message, myId) && (
				<DropdownMenuItem onClick={() => actions.startEdit(message)}>
					<PencilIcon />
					Editar mensagem
				</DropdownMenuItem>
			)}
			<DropdownMenuSeparator />
			<DropdownMenuItem onClick={() =>
					void navigator.clipboard.writeText(message.body).catch(() => {})
				}>
				<CopyIcon />
				Copiar texto
			</DropdownMenuItem>
			{deletable && (
				<>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						variant="danger"
						onClick={(event: MouseEvent) =>
							actions.remove(message, event.shiftKey)
						}
					>
						<Trash2Icon />
						Excluir mensagem
					</DropdownMenuItem>
				</>
			)}
		</>
	);
}

const TOOL =
	"flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground";

/**
 * A barra que aparece em cima da mensagem ao passar o mouse (ou com o foco dentro dela): três
 * reações rápidas, Responder e o "..." com o resto.
 */
export function MessageToolbar({
	message,
	actions,
	onMenuOpenChange,
}: {
	message: Message;
	actions: MessageActionsValue;
	onMenuOpenChange: (open: boolean) => void;
}) {
	return (
		<div
			role="toolbar"
			aria-label="Ações da mensagem"
			className="absolute -top-4 right-6 z-10 hidden items-center gap-0.5 rounded-lg border border-border-strong bg-popover p-0.5 shadow-popover group-focus-within:flex group-hover:flex group-data-[menu-open]:flex"
		>
			{QUICK_REACTIONS.slice(0, 3).map(({ emoji, label }) => (
				<button
					key={emoji}
					type="button"
					aria-label={`Reagir com ${label}`}
					title={`Reagir com ${label}`}
					onClick={() =>
						actions.react(
							message,
							emoji,
							!reacted(message, emoji, actions.myId),
						)
					}
					className={`${TOOL} text-base`}
				>
					{emoji}
				</button>
			))}
			<span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border-strong" />
			<button
				type="button"
				aria-label="Responder"
				title="Responder"
				onClick={() => actions.reply(message)}
				className={TOOL}
			>
				<ReplyIcon className="size-[18px]" />
			</button>
			<DropdownMenu onOpenChange={onMenuOpenChange}>
				<DropdownMenuTrigger
					aria-label="Mais"
					title="Mais"
					className={TOOL}
				>
					<MoreHorizontalIcon className="size-[18px]" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-[236px]">
					<MessageMenuItems
						message={message}
						actions={actions}
						withReactions={false}
					/>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
