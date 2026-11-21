import { AtSignIcon, PlusIcon, XIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Mentionable } from "../model/mentions";
import {
	authorName,
	BODY_MAX,
	COUNTER_FROM,
	draftProblem,
} from "../model/messages";
import {
	addDraftFiles,
	type DraftFile,
	takeDraftFiles,
	useDraftFiles,
} from "../stores/attachmentStore";
import { setDraft, useDraft } from "../stores/draftStore";
import {
	cancelReply,
	toggleReplyMention,
	useReply,
} from "../stores/replyStore";
import { useTypingSignal } from "../hooks/useTypingSignal";
import { AttachmentDrafts } from "./AttachmentDrafts";
import { TypingLine } from "./TypingLine";
import { EmojiSuggest, useEmojiSuggest } from "./EmojiSuggest";
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
 *
 * Embaixo, no espaço que já fica reservado, a linha do "digitando…" (ADR 0027); escrever avisa os
 * outros, no máximo de 3 em 3 segundos.
 *
 * Respondendo (ADR 0032), a faixa "Respondendo a…" fica em cima, com o `@` (ligado: a resposta
 * menciona quem escreveu a original) e o X; Esc também cancela. Com o campo vazio, a seta para
 * cima edita a última mensagem de quem escreve (`onEditLast`).
 *
 * Anexos (decisão 20 do plano da v0.7): o botão +, o Ctrl+V de um arquivo ou de um print, e
 * arrastar para a conversa (quem recebe o arrastar é a `ChatConversation`). Os cartões ficam em
 * cima do campo; com anexo, o texto é opcional.
 */
export function Composer({
	channelId,
	label,
	compact = false,
	mentionable = [],
	myId = null,
	onSend,
	onEditLast,
}: {
	channelId: string;
	/** O que o campo diz enquanto vazio: "Mensagem para #geral", "Mensagem para ana". */
	label: string;
	/** Com menos margem em volta: é o campo da janela de conversa privada. */
	compact?: boolean;
	/** Quem dá para mencionar aqui: no canal, o grupo; na conversa, a outra pessoa. */
	mentionable?: readonly Mentionable[];
	myId?: string | null;
	onSend: (body: string, files: DraftFile[]) => void;
	/** A seta para cima com o campo vazio. Diz se havia o que editar. */
	onEditLast?: () => boolean;
}) {
	const draft = useDraft(channelId);
	const files = useDraftFiles(channelId);
	const fileInput = useRef<HTMLInputElement>(null);
	const reply = useReply(channelId);
	const [problem, setProblem] = useState<string | null>(null);
	const ref = useRef<HTMLTextAreaElement>(null);
	const length = [...draft].length;
	const signalTyping = useTypingSignal(channelId);
	const picker = useMentionPicker({
		field: ref,
		text: draft,
		mentionable,
		myId,
		onChange: (text) => setDraft(channelId, text),
	});
	const emojiSuggest = useEmojiSuggest({
		field: ref,
		text: draft,
		onChange: (text) => setDraft(channelId, text),
	});
	/** A lista aberta agora (as duas nunca abrem juntas: uma começa com `@`, a outra com `:`). */
	const list = picker.open ? picker : emojiSuggest.open ? emojiSuggest : null;

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

	// Clicou em Responder: o campo já fica pronto para a resposta.
	const replyId = reply?.message.id;
	useLayoutEffect(() => {
		if (replyId) ref.current?.focus();
	}, [replyId]);

	function attach(picked: readonly File[]) {
		if (picked.length === 0) return;
		setProblem(addDraftFiles(channelId, picked));
		ref.current?.focus();
	}

	function submit() {
		const empty = draft.trim().length === 0;
		const found = empty && files.length > 0 ? null : draftProblem(draft);
		if (found) {
			// Campo vazio: Enter não faz nada, sem bronca.
			setProblem(empty ? null : found);
			return;
		}
		onSend(draft, takeDraftFiles(channelId));
		setDraft(channelId, "");
		setProblem(null);
	}

	return (
		<div className={cn("shrink-0", compact ? "px-2.5" : "px-4")}>
			{reply && (
				<div className="-mb-1.5 flex h-9 items-center gap-2 rounded-t-[10px] border border-b-0 border-border bg-card pr-2 pb-1.5 pl-3 text-[13px] text-muted-foreground">
					<span className="min-w-0 truncate">
						Respondendo a{" "}
						<strong className="font-semibold text-foreground">
							{authorName(reply.message.author)}
						</strong>
					</span>
					<button
						type="button"
						aria-pressed={reply.mention}
						title={
							reply.mention
								? `Mencionar ${authorName(reply.message.author)}: ligado`
								: `Mencionar ${authorName(reply.message.author)}: desligado`
						}
						onClick={() => toggleReplyMention(channelId)}
						className={cn(
							"ml-auto flex h-[26px] items-center gap-1 rounded-md px-2 text-xs font-bold",
							reply.mention ? "text-link" : "text-foreground-subtle",
						)}
					>
						<AtSignIcon className="size-3.5" />
						{reply.mention ? "Ligado" : "Desligado"}
					</button>
					<button
						type="button"
						aria-label="Cancelar resposta"
						onClick={() => cancelReply(channelId)}
						className="flex size-[26px] items-center justify-center rounded-full hover:bg-secondary hover:text-foreground"
					>
						<XIcon className="size-3.5" />
					</button>
				</div>
			)}
			<div className="relative flex flex-col rounded-[10px] border border-border bg-secondary pr-3.5 pl-1.5 focus-within:border-primary">
				<AttachmentDrafts channelId={channelId} files={files} />
				<div className="flex items-end">
					<button
						type="button"
						aria-label="Anexar arquivos"
						title="Anexar arquivos"
						onClick={() => fileInput.current?.click()}
						className="mb-[11px] flex size-6 shrink-0 items-center justify-center rounded-full bg-muted-foreground text-secondary hover:bg-foreground"
					>
						<PlusIcon className="size-4 stroke-[2.5]" />
					</button>
					<input
						ref={fileInput}
						type="file"
						multiple
						hidden
						aria-label="Escolher arquivos"
						onChange={(event) => {
							const picked = [...(event.target.files ?? [])];
							event.target.value = "";
							attach(picked);
						}}
					/>
					<MentionPicker picker={picker} />
					<EmojiSuggest suggest={emojiSuggest} />
					<textarea
						ref={ref}
						rows={1}
						value={draft}
						aria-label={label}
						placeholder={label}
						aria-autocomplete="list"
						aria-controls={list?.listId}
						aria-activedescendant={list ? list.optionId(list.active) : undefined}
						onChange={(event) => {
							setDraft(channelId, event.target.value);
							if (event.target.value.trim()) signalTyping();
							picker.track(event.target);
							emojiSuggest.track(event.target);
							if (problem) setProblem(null);
						}}
						onSelect={(event) => {
							picker.track(event.currentTarget);
							emojiSuggest.track(event.currentTarget);
						}}
						onPaste={(event) => {
							const pasted = [...event.clipboardData.files];
							if (pasted.length === 0) return;
							event.preventDefault();
							attach(pasted);
						}}
						onKeyDown={(event) => {
							if (picker.onKeyDown(event) || emojiSuggest.onKeyDown(event)) {
								return;
							}
							if (event.key === "Escape" && reply) {
								event.preventDefault();
								cancelReply(channelId);
								return;
							}
							if (
								event.key === "ArrowUp" &&
								draft.length === 0 &&
								onEditLast?.()
							) {
								event.preventDefault();
								return;
							}
							if (
								event.key === "Enter" &&
								!event.shiftKey &&
								!event.nativeEvent.isComposing
							) {
								event.preventDefault();
								submit();
							}
						}}
						className="min-h-[46px] flex-1 resize-none bg-transparent py-3 pl-2.5 text-sm leading-[1.55] text-foreground outline-none placeholder:text-muted-foreground"
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
			</div>
			{problem && (
				<p role="alert" className="pt-1 text-xs text-destructive-text">
					{problem}
				</p>
			)}
			<TypingLine
				channelId={channelId}
				people={mentionable}
				myId={myId}
				className={compact ? "h-5" : "h-[30px]"}
			/>
		</div>
	);
}
