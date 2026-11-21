/**
 * As fixadas (decisão 24 do plano da v0.7): a faixa "1 mensagem fixada · clique para ver" embaixo
 * do cabeçalho e, no clique, a caixa por cima do chat com as fixadas, da fixada mais recente para
 * a mais antiga, cada uma com Ir até a mensagem e, para quem pode, Desafixar.
 */
import { PinIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar } from "@/features/identity";
import type { Message } from "@/lib/api";
import { attachmentsLabel } from "../model/attachments";
import { plainText } from "../model/markdown";
import { authorName, stampLabel } from "../model/messages";
import { usePins } from "../queries";
import type { MessageActionsValue } from "./messageContext";

function pinCount(count: number): string {
	return count === 1 ? "1 mensagem fixada" : `${count} mensagens fixadas`;
}

function PinnedItem({
	message,
	actions,
	onJump,
}: {
	message: Message;
	actions: MessageActionsValue;
	onJump: () => void;
}) {
	const text =
		plainText(message.body) || attachmentsLabel(message.attachments ?? []);
	return (
		<li className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3">
			<div className="flex items-center gap-2">
				<Avatar
					nick={message.author.nick}
					displayName={message.author.display_name}
					avatar={message.author.avatar}
					size={22}
				/>
				<span className="truncate text-sm font-semibold text-foreground">
					{authorName(message.author)}
				</span>
				<span className="shrink-0 text-xs text-muted-foreground">
					{stampLabel(message.created_at)}
				</span>
			</div>
			<p className="line-clamp-3 text-sm whitespace-pre-wrap text-secondary-foreground">
				{text}
			</p>
			<div className="flex gap-3 text-xs font-semibold">
				<button
					type="button"
					onClick={onJump}
					className="text-link hover:underline"
				>
					Ir até a mensagem
				</button>
				{actions.canPin && (
					<button
						type="button"
						onClick={() => actions.pin(message, false)}
						className="text-muted-foreground hover:text-foreground hover:underline"
					>
						Desafixar
					</button>
				)}
			</div>
		</li>
	);
}

export function PinsBar({
	channelId,
	actions,
	compact,
}: {
	channelId: string;
	actions: MessageActionsValue;
	compact: boolean;
}) {
	const pins = usePins(channelId).data ?? [];
	const [open, setOpen] = useState(false);
	if (pins.length === 0) return null;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				aria-label={`${pinCount(pins.length)} · clique para ver`}
				className={cn(
					"flex w-full shrink-0 items-center gap-2 border-b border-border bg-card py-2 text-left text-[13px] text-muted-foreground hover:bg-secondary",
					compact ? "px-3" : "px-4",
				)}
			>
				<PinIcon aria-hidden="true" className="size-3.5 shrink-0 text-link" />
				<span className="truncate">
					<strong className="font-semibold text-foreground">
						{pinCount(pins.length)}
					</strong>{" "}
					· clique para ver
				</span>
			</PopoverTrigger>
			<PopoverContent
					align="start"
					className="max-h-[min(70vh,520px)] w-[min(420px,calc(100vw-2rem))] overflow-hidden p-0"
				>
					<PopoverTitle className="border-b border-border px-4 py-3 text-sm font-bold">
						Mensagens fixadas
					</PopoverTitle>
					<ul className="flex flex-col gap-2 overflow-y-auto px-3 pb-3">
						{pins.map((message) => (
							<PinnedItem
								key={message.id}
								message={message}
								actions={actions}
								onJump={() => {
									setOpen(false);
									actions.jumpTo(message.id);
								}}
							/>
						))}
					</ul>
			</PopoverContent>
		</Popover>
	);
}
