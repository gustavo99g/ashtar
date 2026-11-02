import { Avatar, PersonName } from "@/features/identity";
import type { Message } from "@/lib/api";
import { cn } from "@/lib/utils";
import { authorName, timeLabel } from "../model/messages";
import type { PendingMessage } from "../stores/outboxStore";
import { MessageBody } from "./MessageBody";

/**
 * Uma mensagem. A primeira do grupo leva o avatar, o nome e a hora; as seguintes do mesmo autor
 * só o texto, com a hora aparecendo ao passar o mouse.
 */
export function MessageItem({
	message,
	startsGroup,
	ownerId,
}: {
	message: Message;
	startsGroup: boolean;
	ownerId: string | null;
}) {
	const { author } = message;
	const name = authorName(author);
	return (
		<li
			className={cn(
				"group relative flex gap-4 px-4 hover:bg-secondary/40",
				startsGroup ? "mt-[17px] py-0.5" : "py-px",
			)}
		>
			<div className="w-10 shrink-0">
				{startsGroup ? (
					<Avatar
						nick={author.nick}
						displayName={author.display_name}
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
						<PersonName owner={author.id === ownerId} className="text-[15px]">
							{name}
						</PersonName>
						{author.removed && (
							<span className="text-xs text-muted-foreground">
								(saiu do grupo)
							</span>
						)}
						<time className="text-xs text-muted-foreground">
							{timeLabel(message.created_at)}
						</time>
					</div>
				)}
				<MessageBody body={message.body} />
			</div>
		</li>
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
				<MessageBody body={message.body} />
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
