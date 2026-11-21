import { SmilePlusIcon } from "lucide-react";
import { useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { CustomEmoji, customId, useEmojiById } from "@/features/emojis";
import type { Message } from "@/lib/api";
import { cn } from "@/lib/utils";
import { authorName } from "../model/messages";
import { EmojiPicker } from "./EmojiPicker";
import { pickReaction } from "./MessageActions";
import type { MessageActionsValue } from "./messageContext";

/** Os nomes de quem reagiu, para o `title`: "Kid, Bia e mais 3". */
function whoReacted(
	users: readonly string[],
	actions: MessageActionsValue,
): string {
	const names = users
		.slice(0, 5)
		.map((id) =>
			id === actions.myId
				? "você"
				: (() => {
						const person = actions.people.get(id);
						return person ? authorName(person) : "alguém";
					})(),
		);
	const rest = users.length - names.length;
	return rest > 0 ? `${names.join(", ")} e mais ${rest}` : names.join(", ");
}

/**
 * As reações embaixo da mensagem (o quadro "Chat — menu da mensagem"): o emoji e quantos, em azul
 * quando quem lê está entre eles. Clicar põe ou tira a própria; o "+" no fim abre o seletor.
 */
export function Reactions({
	message,
	actions,
}: {
	message: Message;
	actions: MessageActionsValue | null;
}) {
	const [pickerOpen, setPickerOpen] = useState(false);
	const byId = useEmojiById();
	// A reação com um emoji do grupo que foi excluído some (a API também já tirou).
	const reactions = message.reactions.filter((reaction) => {
		const id = customId(reaction.emoji);
		return id === null || byId.has(id);
	});
	if (reactions.length === 0) return null;
	return (
		<div className="mt-1 flex flex-wrap gap-1">
			{reactions.map((reaction) => {
				const custom = byId.get(customId(reaction.emoji) ?? "");
				const mine =
					actions?.myId != null && reaction.users.includes(actions.myId);
				const count = reaction.users.length;
				const shown = custom ? `:${custom.name}:` : reaction.emoji;
				const label = `Reação ${shown}, ${count} ${count === 1 ? "pessoa" : "pessoas"}${mine ? ", incluindo você" : ""}`;
				return (
					<button
						key={reaction.emoji}
						type="button"
						aria-pressed={mine}
						aria-label={label}
						title={actions ? whoReacted(reaction.users, actions) : undefined}
						disabled={!actions}
						onClick={() => actions?.react(message, reaction.emoji, !mine)}
						className={cn(
							"flex h-7 items-center gap-1.5 rounded-md border px-2 text-[13px]",
							mine
								? "border-primary bg-primary/20"
								: "border-border bg-secondary hover:border-border-strong",
						)}
					>
						{custom ? (
							<CustomEmoji emoji={custom} className="size-[18px] align-middle" />
						) : (
							<span>{reaction.emoji}</span>
						)}
						<span
							className={cn(
								"text-xs font-semibold",
								mine ? "text-foreground" : "text-muted-foreground",
							)}
						>
							{count}
						</span>
					</button>
				);
			})}
			{actions && (
				<Popover open={pickerOpen} onOpenChange={setPickerOpen}>
					<PopoverTrigger
						aria-label="Adicionar reação"
						className="flex h-7 w-[30px] items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground hover:border-border-strong hover:text-foreground data-popup-open:border-primary data-popup-open:bg-primary/20"
					>
						<SmilePlusIcon className="size-4" />
					</PopoverTrigger>
					<PopoverContent align="start" className="w-auto gap-0 p-0">
						<EmojiPicker
							onPick={(emoji) => {
								setPickerOpen(false);
								pickReaction(message, actions, emoji);
							}}
						/>
					</PopoverContent>
				</Popover>
			)}
		</div>
	);
}
