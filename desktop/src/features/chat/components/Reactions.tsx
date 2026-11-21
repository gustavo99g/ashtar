import type { Message } from "@/lib/api";
import { cn } from "@/lib/utils";
import { authorName } from "../model/messages";
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
 * quando quem lê está entre eles. Clicar põe ou tira a própria.
 */
export function Reactions({
	message,
	actions,
}: {
	message: Message;
	actions: MessageActionsValue | null;
}) {
	if (message.reactions.length === 0) return null;
	return (
		<div className="mt-1 flex flex-wrap gap-1">
			{message.reactions.map((reaction) => {
				const mine =
					actions?.myId != null && reaction.users.includes(actions.myId);
				const count = reaction.users.length;
				const label = `Reação ${reaction.emoji}, ${count} ${count === 1 ? "pessoa" : "pessoas"}${mine ? ", incluindo você" : ""}`;
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
						<span>{reaction.emoji}</span>
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
		</div>
	);
}
