import { ForwardIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Avatar, PersonName } from "@/features/identity";
import type { FileView, Message } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Mentionable } from "../model/mentions";
import { authorName, stampLabel, timeLabel } from "../model/messages";
import type { PendingMessage } from "../stores/outboxStore";
import { Attachments, PendingFiles } from "./Attachments";
import { InviteCards } from "./InviteCards";
import { LinkPreviews } from "./LinkPreviews";
import { MessageMenuItems, MessageToolbar } from "./MessageActions";
import { MessageBody } from "./MessageBody";
import { MessageEditor } from "./MessageEditor";
import { useMessageActionsContext } from "./messageContext";
import { Reactions } from "./Reactions";
import { ReplyQuote } from "./ReplyQuote";

/**
 * Uma mensagem, como no quadro "Canal de texto": a primeira do grupo leva o avatar, o nome (dourado
 * e com o selo Dono, no dono) e "Hoje às 09:14"; as seguintes do mesmo autor só o texto, com a hora
 * aparecendo ao passar o mouse.
 *
 * A mensagem que menciona quem lê ganha o fundo dourado suave e um traço dourado à esquerda.
 *
 * Com as ações (ADR 0032, dadas pela `ChatConversation`): a barra ao passar o mouse, o menu do botão
 * direito, a citação da resposta em cima, a edição no lugar, "(editada)" e as reações embaixo.
 */
export function MessageItem({
	message,
	startsGroup,
	ownerId,
	people,
	myId,
}: {
	message: Message;
	startsGroup: boolean;
	ownerId: string | null;
	/** Quem está no grupo, por id: o nome das menções. */
	people: ReadonlyMap<string, Mentionable>;
	myId: string | null;
}) {
	const actions = useMessageActionsContext();
	const [menuOpen, setMenuOpen] = useState(false);
	const [menuImage, setMenuImage] = useState<FileView | null>(null);
	const [pickerOpen, setPickerOpen] = useState(false);
	const { author } = message;
	const name = authorName(author);
	const mentioned = message.mentions
		.map((id) => people.get(id))
		.filter((p): p is Mentionable => p !== undefined);
	const mentionsMe = myId !== null && message.mentions.includes(myId);
	const editing = actions?.editingId === message.id;
	const highlighted = actions?.highlightId === message.id;

	const row = (
		<li
			// O botão direito numa imagem põe Copiar imagem e Baixar no começo do menu.
			onContextMenuCapture={(event) => {
				const id = (event.target as HTMLElement)
					.closest("[data-image-id]")
					?.getAttribute("data-image-id");
				setMenuImage(
					message.attachments?.find((file) => file.id === id) ?? null,
				);
			}}
			data-message-id={message.id}
			data-mentions-me={mentionsMe || undefined}
			data-menu-open={menuOpen || pickerOpen || undefined}
			className={cn(
				"group relative px-4",
				mentionsMe
					? "bg-gold/10 shadow-[inset_2px_0_0_var(--color-gold)] hover:bg-gold/15"
					: editing
						? "bg-secondary/80"
						: "hover:bg-secondary/80 data-[menu-open]:bg-secondary/80",
				highlighted && "animate-[pulse_1s_ease-in-out_2] bg-primary/15",
				startsGroup ? "mt-3 py-1" : "py-px",
			)}
		>
			{message.reply_to && (
				<ReplyQuote reply={message.reply_to} onJump={actions?.jumpTo} />
			)}
			<div className="flex gap-4">
				<div className="w-10 shrink-0">
					{startsGroup ? (
						<Avatar
							nick={author.nick}
							displayName={author.display_name}
							avatar={author.avatar}
							size={40}
						/>
					) : (
						<time className="invisible block pt-1 text-right text-[11px] text-muted-foreground group-hover:visible">
							{timeLabel(message.created_at)}
						</time>
					)}
				</div>
				<div className="min-w-0 flex-1">
					{startsGroup && (
						<div className="flex items-baseline gap-2">
							<PersonName owner={author.id === ownerId} className="text-sm">
								{name}
							</PersonName>
							{author.id === ownerId && (
								<Badge tone="gold" className="px-1.5 py-px text-[11px]">
									Dono
								</Badge>
							)}
							{author.removed && (
								<span className="text-xs text-muted-foreground">
									(saiu do grupo)
								</span>
							)}
							<time className="text-xs text-muted-foreground">
								{stampLabel(message.created_at)}
							</time>
						</div>
					)}
					{message.forwarded && (
						<p className="flex items-center gap-1.5 pt-0.5 text-xs text-muted-foreground">
							<ForwardIcon aria-hidden="true" className="size-3.5 shrink-0" />
							<span className="truncate">
								Encaminhada · {message.forwarded.author_name}
								{message.forwarded.channel_name
									? ` em #${message.forwarded.channel_name}`
									: ""}{" "}
								· {stampLabel(message.forwarded.created_at)}
							</span>
						</p>
					)}
					{editing && actions ? (
						<MessageEditor
							message={message}
							onSave={(body) => actions.saveEdit(message, body)}
							onCancel={actions.stopEdit}
						/>
					) : (
						<MessageBody
							body={message.body}
							mentioned={mentioned}
							editedAt={message.edited_at}
						/>
					)}
					<Attachments files={message.attachments ?? []} />
					<InviteCards body={message.body} />
					<LinkPreviews message={message} mine={message.author.id === myId} />
					<Reactions message={message} actions={actions} />
				</div>
			</div>
			{actions && !editing && message.kind === "text" && (
				<MessageToolbar
					message={message}
					actions={actions}
					onMenuOpenChange={setMenuOpen}
					pickerOpen={pickerOpen}
					onPickerOpenChange={setPickerOpen}
				/>
			)}
		</li>
	);

	if (!actions || message.kind !== "text" || editing) return row;
	return (
		<ContextMenu onOpenChange={setMenuOpen}>
			<ContextMenuTrigger render={row} />
			<ContextMenuContent aria-label={`Mensagem de ${name}`}>
				<MessageMenuItems
					message={message}
					actions={actions}
					image={menuImage}
					withReactions
					onOpenPicker={() => setPickerOpen(true)}
				/>
			</ContextMenuContent>
		</ContextMenu>
	);
}

/** Uma mensagem que ainda não chegou na API: apagada, ou com o erro e "Tentar de novo". */
export function PendingItem({
	message,
	onRetry,
	onDiscard,
}: {
	message: PendingMessage;
	onRetry: () => void;
	onDiscard: () => void;
}) {
	return (
		<li
			className="flex gap-4 px-4 py-px"
			aria-busy={message.status === "sending"}
		>
			<div className="w-10 shrink-0" />
			<div
				className={cn(
					"min-w-0 flex-1",
					message.status === "sending" && "opacity-50",
				)}
			>
				{message.forward && (
					<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<ForwardIcon aria-hidden="true" className="size-3.5" />
						Encaminhando…
					</p>
				)}
				<MessageBody body={message.body} />
				<PendingFiles files={message.files ?? []} />
				{message.status === "failed" && (
					<p role="alert" className="text-xs text-destructive-text">
						Não enviada: {message.error}{" "}
						<button
							type="button"
							onClick={onRetry}
							className="font-semibold text-link hover:underline"
						>
							Tentar de novo
						</button>
						{" · "}
						<button
							type="button"
							onClick={onDiscard}
							className="font-semibold text-muted-foreground hover:underline"
						>
							Descartar
						</button>
					</p>
				)}
			</div>
		</li>
	);
}
