import {
	type KeyboardEvent,
	type RefObject,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { CustomEmoji, useGroupEmojis } from "@/features/emojis";
import type { Emoji } from "@/lib/api";
import { cn } from "@/lib/utils";
import { applyEmoji, emojiOptions, emojiQuery } from "../model/customEmoji";

/**
 * A sugestão dos emojis do grupo no campo de escrever (decisão 31 do plano da v0.7): ao digitar
 * `:` e o começo do nome, aparece a lista. Funciona como a das menções (`MentionPicker`): as setas
 * andam, Enter ou Tab escolhem, Esc fecha. O que entra no texto é `:nome: `.
 */
export function useEmojiSuggest({
	field,
	text,
	onChange,
}: {
	field: RefObject<HTMLTextAreaElement | null>;
	text: string;
	onChange: (text: string) => void;
}) {
	const emojis = useGroupEmojis();
	const listId = useId();
	const [caret, setCaret] = useState(0);
	const [dismissed, setDismissed] = useState<number | null>(null);
	const [highlight, setHighlight] = useState(0);
	const nextCaret = useRef<number | null>(null);

	const found = emojiQuery(text, caret);
	const options =
		found && found.start !== dismissed ? emojiOptions(emojis, found.query) : [];
	const open = options.length > 0;
	const active = Math.min(highlight, options.length - 1);

	useLayoutEffect(() => {
		const position = nextCaret.current;
		if (position === null) return;
		nextCaret.current = null;
		field.current?.setSelectionRange(position, position);
		setCaret(position);
	}, [text, field]);

	function choose(emoji: Emoji) {
		if (!found) return;
		const next = applyEmoji(text, found.start, caret, emoji.name);
		nextCaret.current = next.caret;
		setHighlight(0);
		onChange(next.text);
	}

	function track(target: HTMLTextAreaElement) {
		if (target.selectionStart !== caret) setHighlight(0);
		setCaret(target.selectionStart);
	}

	function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
		if (!open || !found) return false;
		switch (event.key) {
			case "ArrowDown":
				setHighlight((active + 1) % options.length);
				break;
			case "ArrowUp":
				setHighlight((active - 1 + options.length) % options.length);
				break;
			case "Enter":
			case "Tab":
				if (event.shiftKey || event.nativeEvent.isComposing) return false;
				choose(options[active]);
				break;
			case "Escape":
				event.stopPropagation();
				setDismissed(found.start);
				break;
			default:
				return false;
		}
		event.preventDefault();
		return true;
	}

	return {
		open,
		options,
		active,
		listId,
		optionId: (index: number) => `${listId}-${index}`,
		choose,
		track,
		onKeyDown,
	};
}

export type EmojiSuggestState = ReturnType<typeof useEmojiSuggest>;

export function EmojiSuggest({ suggest }: { suggest: EmojiSuggestState }) {
	if (!suggest.open) return null;
	return (
		<ul
			id={suggest.listId}
			role="listbox"
			aria-label="Emojis do grupo"
			className="absolute right-0 bottom-full left-0 mb-2 flex max-h-[280px] flex-col overflow-y-auto rounded-[10px] border border-border-strong bg-popover p-1.5 shadow-lg"
		>
			<li
				role="presentation"
				className="px-2 pt-1 pb-1.5 text-[11px] font-bold tracking-[0.06em] text-muted-foreground uppercase"
			>
				Emojis do grupo
			</li>
			{suggest.options.map((emoji, index) => (
				<li
					key={emoji.id}
					id={suggest.optionId(index)}
					role="option"
					aria-selected={index === suggest.active}
					onMouseDown={(event) => {
						event.preventDefault();
						suggest.choose(emoji);
					}}
					className={cn(
						"flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5",
						index === suggest.active ? "bg-secondary" : "hover:bg-secondary/60",
					)}
				>
					<span aria-hidden="true" className="contents">
						<CustomEmoji emoji={emoji} className="size-6" />
					</span>
					<span className="truncate font-mono text-sm text-foreground">
						:{emoji.name}:
					</span>
				</li>
			))}
		</ul>
	);
}
