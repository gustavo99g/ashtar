import {
	type KeyboardEvent,
	type RefObject,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Avatar } from "@/features/identity";
import { cn } from "@/lib/utils";
import {
	applyMention,
	type Mentionable,
	mentionOptions,
	mentionQuery,
} from "../model/mentions";
import { authorName } from "../model/messages";

/**
 * A sugestão de nicks do campo de escrever (ADR 0022). Ao digitar `@`, aparece a lista de quem dá
 * para mencionar, filtrada pelo que vem depois (nick e nome visível). As setas andam, Enter ou Tab
 * escolhem, Esc fecha. O que entra no texto é `@nick ` (com o espaço), que é o que a API procura.
 *
 * O hook guarda onde está o cursor (`caret`), porque o que conta é o `@` antes dele, e não o último
 * do texto. O Esc fecha aquele `@`; um `@` novo abre de novo.
 */
export function useMentionPicker({
	field,
	text,
	mentionable,
	myId,
	onChange,
}: {
	field: RefObject<HTMLTextAreaElement | null>;
	text: string;
	/** Quem dá para mencionar aqui. Sem ninguém, a lista nunca abre. */
	mentionable: readonly Mentionable[];
	myId: string | null;
	/** O texto novo, com a menção escolhida. */
	onChange: (text: string) => void;
}) {
	const listId = useId();
	const [caret, setCaret] = useState(0);
	const [dismissed, setDismissed] = useState<number | null>(null);
	const [highlight, setHighlight] = useState(0);
	/** Onde pôr o cursor depois que o texto com a menção for desenhado. */
	const nextCaret = useRef<number | null>(null);

	const found = mentionQuery(text, caret);
	const options =
		found && found.start !== dismissed
			? mentionOptions(mentionable, found.query, myId)
			: [];
	const open = options.length > 0;
	const active = Math.min(highlight, options.length - 1);

	useLayoutEffect(() => {
		const position = nextCaret.current;
		if (position === null) return;
		nextCaret.current = null;
		field.current?.setSelectionRange(position, position);
		setCaret(position);
	}, [text, field]);

	function choose(person: Mentionable) {
		if (!found) return;
		const next = applyMention(text, found.start, caret, person.nick);
		nextCaret.current = next.caret;
		setHighlight(0);
		onChange(next.text);
	}

	/** O cursor andou (digitando, clicando ou com as setas). */
	function track(target: HTMLTextAreaElement) {
		if (target.selectionStart !== caret) setHighlight(0);
		setCaret(target.selectionStart);
	}

	/** `true` se a tecla era da lista: aí o campo não faz mais nada com ela. */
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
				// Não deixa o Esc chegar na janela da conversa, que fecharia.
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

export type MentionPickerState = ReturnType<typeof useMentionPicker>;

/** A lista, por cima do campo. */
export function MentionPicker({ picker }: { picker: MentionPickerState }) {
	if (!picker.open) return null;
	return (
		<ul
			id={picker.listId}
			role="listbox"
			aria-label="Mencionar"
			className="absolute right-0 bottom-full left-0 mb-2 flex max-h-[280px] flex-col overflow-y-auto rounded-[10px] border border-border-strong bg-popover p-1.5 shadow-lg"
		>
			<li
				role="presentation"
				className="px-2 pt-1 pb-1.5 text-[11px] font-bold tracking-[0.06em] text-muted-foreground uppercase"
			>
				Membros
			</li>
			{picker.options.map((person, index) => (
				<li
					key={person.id}
					id={picker.optionId(index)}
					role="option"
					aria-selected={index === picker.active}
					// O clique não pode tirar o foco do campo.
					onMouseDown={(event) => {
						event.preventDefault();
						picker.choose(person);
					}}
					className={cn(
						"flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5",
						index === picker.active ? "bg-secondary" : "hover:bg-secondary/60",
					)}
				>
					<span aria-hidden="true" className="contents">
						<Avatar nick={person.nick} displayName={person.display_name} size={24} />
					</span>
					<span className="truncate text-sm font-semibold text-foreground">
						{authorName(person)}
					</span>
					<span className="truncate text-xs text-muted-foreground">
						@{person.nick}
					</span>
				</li>
			))}
		</ul>
	);
}
