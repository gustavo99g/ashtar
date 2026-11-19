import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Mentionable } from "../model/mentions";
import { BODY_MAX, COUNTER_FROM, draftProblem } from "../model/messages";
import { setDraft, useDraft } from "../stores/draftStore";
import { MentionPicker, useMentionPicker } from "./MentionPicker";

/** Altura máxima do campo antes de rolar por dentro (umas 10 linhas). */
const MAX_HEIGHT = 240;

/**
 * O campo de escrever, de um canal ou de uma conversa privada (o `channelId` é o de qualquer um
 * dos dois). Enter manda, Shift+Enter quebra a linha. O texto é o rascunho do canal
 * (`draftStore`): trocar de canal e voltar traz de volta o que estava escrito. Perto do limite
 * aparece a contagem; um texto que a API recusaria nem sai, e o motivo aparece embaixo.
 *
 * Digitar `@` abre a sugestão de nicks (`MentionPicker`) com quem está em `mentionable`.
 */
export function Composer({
	channelId,
	label,
	compact = false,
	mentionable = [],
	myId = null,
	onSend,
}: {
	channelId: string;
	/** O que o campo diz enquanto vazio: "Mensagem para #geral", "Mensagem para ana". */
	label: string;
	/** Com menos margem em volta: é o campo da janela de conversa privada. */
	compact?: boolean;
	/** Quem dá para mencionar aqui: no canal, o grupo; na conversa, a outra pessoa. */
	mentionable?: readonly Mentionable[];
	myId?: string | null;
	onSend: (body: string) => void;
}) {
	const draft = useDraft(channelId);
	const [problem, setProblem] = useState<string | null>(null);
	const ref = useRef<HTMLTextAreaElement>(null);
	const length = [...draft].length;
	const picker = useMentionPicker({
		field: ref,
		text: draft,
		mentionable,
		myId,
		onChange: (text) => setDraft(channelId, text),
	});

	// O campo cresce com o texto, até o máximo.
	useLayoutEffect(() => {
		const field = ref.current;
		if (!field) return;
		field.style.height = "auto";
		field.style.height = `${Math.min(field.scrollHeight, MAX_HEIGHT)}px`;
	}, [draft]);

	// Abrir outro canal já deixa pronto para escrever nele.
	useLayoutEffect(() => {
		ref.current?.focus();
		setProblem(null);
	}, [channelId]);

	function submit() {
		const found = draftProblem(draft);
		if (found) {
			// Campo vazio: Enter não faz nada, sem bronca.
			setProblem(draft.trim().length === 0 ? null : found);
			return;
		}
		onSend(draft);
		setDraft(channelId, "");
		setProblem(null);
	}

	return (
		<div className={cn("shrink-0", compact ? "px-2.5 pb-2.5" : "px-4 pb-[30px]")}>
			<div className="relative flex items-end rounded-[10px] border border-border bg-secondary px-3.5 focus-within:border-primary">
				<MentionPicker picker={picker} />
				<textarea
					ref={ref}
					rows={1}
					value={draft}
					aria-label={label}
					placeholder={label}
					aria-autocomplete="list"
					aria-controls={picker.open ? picker.listId : undefined}
					aria-activedescendant={
						picker.open ? picker.optionId(picker.active) : undefined
					}
					onChange={(event) => {
						setDraft(channelId, event.target.value);
						picker.track(event.target);
						if (problem) setProblem(null);
					}}
					onSelect={(event) => picker.track(event.currentTarget)}
					onKeyDown={(event) => {
						if (picker.onKeyDown(event)) return;
						if (
							event.key === "Enter" &&
							!event.shiftKey &&
							!event.nativeEvent.isComposing
						) {
							event.preventDefault();
							submit();
						}
					}}
					className="min-h-[46px] flex-1 resize-none bg-transparent py-3 text-sm leading-[1.55] text-foreground outline-none placeholder:text-muted-foreground"
				/>
				{length >= COUNTER_FROM && (
					<span
						className={cn(
							"shrink-0 pb-3.5 pl-2 font-mono text-xs",
							length > BODY_MAX
								? "text-destructive-text"
								: "text-muted-foreground",
						)}
					>
						{length}/{BODY_MAX}
					</span>
				)}
			</div>
			{problem && (
				<p role="alert" className="pt-1 text-xs text-destructive-text">
					{problem}
				</p>
			)}
		</div>
	);
}
