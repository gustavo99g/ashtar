import { cn } from "@/lib/utils";
import type { Mentionable } from "../model/mentions";
import { typingLabel, useTyping } from "../stores/typingStore";

/**
 * "fulano está digitando…" embaixo do campo de escrever (ADR 0027). A altura fica sempre
 * reservada, para a conversa não pular quando a linha aparece e some.
 */
export function TypingLine({
	channelId,
	people,
	myId,
	className,
}: {
	channelId: string;
	/** De onde vêm os nomes: quem pode estar no canal. */
	people: readonly Mentionable[];
	myId: string | null;
	/** A altura reservada. */
	className?: string;
}) {
	const typing = useTyping(channelId);
	const names = typing
		.filter((id) => id !== myId)
		.map((id) => people.find((person) => person.id === id))
		.filter((person) => person !== undefined)
		.map((person) => person.display_name ?? person.nick);
	const label = typingLabel(names);
	return (
		<p
			aria-live="polite"
			className={cn(
				"flex items-center truncate text-xs text-muted-foreground",
				className,
			)}
		>
			{label && <span className="truncate italic">{label}</span>}
		</p>
	);
}
