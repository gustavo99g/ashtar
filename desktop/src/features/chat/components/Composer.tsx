import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { BODY_MAX, COUNTER_FROM, draftProblem } from "../model/messages";
import { setDraft, useDraft } from "../stores/draftStore";

/** Altura máxima do campo antes de rolar por dentro (umas 10 linhas). */
const MAX_HEIGHT = 240;

/**
 * O campo de escrever. Enter manda, Shift+Enter quebra a linha. O texto é o rascunho do canal
 * (`draftStore`): trocar de canal e voltar traz de volta o que estava escrito. Perto do limite
 * aparece a contagem; um texto que a API recusaria nem sai, e o motivo aparece embaixo.
 */
export function Composer({
	channelId,
	channelName,
	onSend,
}: {
	channelId: string;
	channelName: string;
	onSend: (body: string) => void;
}) {
	const draft = useDraft(channelId);
	const [problem, setProblem] = useState<string | null>(null);
	const ref = useRef<HTMLTextAreaElement>(null);
	const length = [...draft].length;

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
		<div className="shrink-0 px-4 pb-6">
			<div className="flex items-end rounded-lg bg-input px-4">
				<textarea
					ref={ref}
					rows={1}
					value={draft}
					aria-label={`Mensagem para #${channelName}`}
					placeholder={`Conversar em #${channelName}`}
					onChange={(event) => {
						setDraft(channelId, event.target.value);
						if (problem) setProblem(null);
					}}
					onKeyDown={(event) => {
						if (
							event.key === "Enter" &&
							!event.shiftKey &&
							!event.nativeEvent.isComposing
						) {
							event.preventDefault();
							submit();
						}
					}}
					className="min-h-11 flex-1 resize-none bg-transparent py-[11px] text-[15px] leading-[1.375] text-foreground outline-none placeholder:text-muted-foreground"
				/>
				{length >= COUNTER_FROM && (
					<span
						className={cn(
							"shrink-0 pb-3 pl-2 font-mono text-xs",
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
