import { useLayoutEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, type Message } from "@/lib/api";
import { draftProblem } from "../model/messages";

/** Altura máxima do campo antes de rolar por dentro, como no campo de escrever. */
const MAX_HEIGHT = 240;

/**
 * Editar a mensagem no lugar (o quadro "Chat — editando"): Enter salva, Shift+Enter quebra a linha,
 * Esc cancela. Salvar o mesmo texto só fecha. Se a API recusar, o motivo aparece embaixo e o campo
 * continua aberto.
 */
export function MessageEditor({
	message,
	onSave,
	onCancel,
}: {
	message: Message;
	onSave: (body: string) => Promise<void>;
	onCancel: () => void;
}) {
	const [text, setText] = useState(message.body);
	const [problem, setProblem] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const ref = useRef<HTMLTextAreaElement>(null);

	useLayoutEffect(() => {
		const field = ref.current;
		if (!field) return;
		field.style.height = "auto";
		field.style.height = `${Math.min(field.scrollHeight, MAX_HEIGHT)}px`;
	}, [text]);

	useLayoutEffect(() => {
		const field = ref.current;
		if (!field) return;
		field.focus();
		field.setSelectionRange(field.value.length, field.value.length);
	}, []);

	async function save() {
		if (saving) return;
		if (text.trim() === message.body) {
			onCancel();
			return;
		}
		const found = draftProblem(text);
		if (found) {
			setProblem(found);
			return;
		}
		setSaving(true);
		try {
			await onSave(text);
			onCancel();
		} catch (error) {
			setProblem(
				error instanceof ApiError
					? error.message
					: "Não foi possível salvar a edição.",
			);
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="mt-0.5 flex flex-col gap-1.5">
			<textarea
				ref={ref}
				rows={1}
				value={text}
				aria-label="Editar mensagem"
				onChange={(event) => {
					setText(event.target.value);
					if (problem) setProblem(null);
				}}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						onCancel();
					} else if (
						event.key === "Enter" &&
						!event.shiftKey &&
						!event.nativeEvent.isComposing
					) {
						event.preventDefault();
						void save();
					}
				}}
				className="w-full resize-none rounded-lg border border-primary bg-secondary px-3 py-2.5 text-sm leading-[1.55] text-foreground outline-none"
			/>
			{problem && (
				<p role="alert" className="text-xs text-destructive-text">
					{problem}
				</p>
			)}
			<p className="flex items-center gap-2 text-xs text-muted-foreground">
				<span>
					Esc para{" "}
					<button
						type="button"
						onClick={onCancel}
						className="text-link hover:underline"
					>
						cancelar
					</button>{" "}
					· Enter para{" "}
					<button
						type="button"
						onClick={() => void save()}
						className="text-link hover:underline"
					>
						salvar
					</button>
				</span>
				{saving && <Spinner className="size-3.5" />}
			</p>
		</div>
	);
}
