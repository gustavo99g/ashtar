import {
	CopyIcon,
	ForwardIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PinIcon,
	PinOffIcon,
	ReplyIcon,
	SmilePlusIcon,
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
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import type { FileView, Message } from "@/lib/api";
import { ImageMenuItems } from "./Attachments";
import { EmojiPicker } from "./EmojiPicker";
import {
	canDelete,
	canEdit,
	type MessageActionsValue,
	QUICK_REACTIONS,
} from "./messageContext";
import { requestForward } from "../stores/forwardStore";

/** Se quem lê já reagiu com `emoji`. */
export function reacted(
	message: Message,
	emoji: string,
	myId: string | null,
): boolean {
	return (
		myId !== null &&
		(message.reactions.find((r) => r.emoji === emoji)?.users.includes(myId) ??
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
	image,
	onOpenPicker,
}: {
	message: Message;
	actions: MessageActionsValue;
	withReactions: boolean;
	/** A imagem em que o botão direito caiu: o menu começa com Copiar imagem e Baixar. */
	image?: FileView | null;
	/** Abre o seletor de emoji da barra (o Reagir do menu). */
	onOpenPicker?: () => void;
}) {
	const { myId } = actions;
	const deletable = canDelete(message, myId, actions.canModerate);
	return (
		<>
			{image && (
				<>
					<ImageMenuItems file={image} />
					<DropdownMenuSeparator />
				</>
			)}
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
			{onOpenPicker && (
				<DropdownMenuItem onClick={onOpenPicker}>
					<SmilePlusIcon />
					Reagir
				</DropdownMenuItem>
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
			{actions.canPin && (
				<DropdownMenuItem
					onClick={() => actions.pin(message, message.pinned_at === null)}
				>
					{message.pinned_at === null ? <PinIcon /> : <PinOffIcon />}
					{message.pinned_at === null ? "Fixar mensagem" : "Desafixar mensagem"}
				</DropdownMenuItem>
			)}
			<DropdownMenuItem onClick={() => requestForward(message)}>
				<ForwardIcon />
				Encaminhar
			</DropdownMenuItem>
			<DropdownMenuSeparator />
			<DropdownMenuItem
				onClick={() =>
					void navigator.clipboard.writeText(message.body).catch(() => {})
				}
			>
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

/** Escolher no seletor reage, ou tira a reação se quem lê já tinha reagido com aquele emoji. */
export function pickReaction(
	message: Message,
	actions: MessageActionsValue,
	emoji: string,
): void {
	actions.react(message, emoji, !reacted(message, emoji, actions.myId));
}

/**
 * A barra que aparece em cima da mensagem ao passar o mouse (ou com o foco dentro dela): três
 * reações rápidas, Reagir (o seletor), Responder e o "..." com o resto.
 */
export function MessageToolbar({
	message,
	actions,
	onMenuOpenChange,
	pickerOpen,
	onPickerOpenChange,
}: {
	message: Message;
	actions: MessageActionsValue;
	onMenuOpenChange: (open: boolean) => void;
	pickerOpen: boolean;
	onPickerOpenChange: (open: boolean) => void;
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
			<Popover open={pickerOpen} onOpenChange={onPickerOpenChange}>
				<PopoverTrigger aria-label="Reagir" title="Reagir" className={TOOL}>
					<SmilePlusIcon className="size-[18px]" />
				</PopoverTrigger>
				<PopoverContent
					side="left"
					align="start"
					className="w-auto gap-0 p-0 data-closed:animate-none"
				>
					<EmojiPicker
						onPick={(emoji) => {
							onPickerOpenChange(false);
							pickReaction(message, actions, emoji);
						}}
					/>
				</PopoverContent>
			</Popover>
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
				<DropdownMenuTrigger aria-label="Mais" title="Mais" className={TOOL}>
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
