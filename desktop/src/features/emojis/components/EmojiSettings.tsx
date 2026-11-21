/**
 * Painel de controle › Emojis (decisão 31 do plano da v0.7): os emojis do grupo, até 100, com
 * Enviar, Renomear e Excluir. Só aparece para quem tem "Gerenciar emojis"; a API responde 403 aos
 * outros. A lista muda sozinha pelo `emojis.changed`.
 */
import { SmilePlusIcon } from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { TextField } from "@/components/ui/text-field";
import { ApiError, type Emoji } from "@/lib/api";
import {
	emojiFileProblem,
	emojiNameProblem,
	nameFromFile,
} from "../model/emojiImage";
import { useCreateEmoji, useDeleteEmoji, useRenameEmoji } from "../queries";
import { useEmojiStore } from "../stores/emojiStore";
import { CustomEmoji } from "./CustomEmoji";

const MAX = 100;

function message(error: unknown): string {
	if (error instanceof ApiError) return error.message;
	if (error instanceof Error) return error.message;
	return "Tente de novo.";
}

export function EmojiSettings() {
	const emojis = useEmojiStore((state) => state.emojis);
	const input = useRef<HTMLInputElement>(null);
	const [chosen, setChosen] = useState<File | null>(null);
	const [problem, setProblem] = useState<string | null>(null);

	function choose(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file) return;
		const wrong = emojiFileProblem(file);
		setProblem(wrong);
		setChosen(wrong ? null : file);
	}

	const full = (emojis?.length ?? 0) >= MAX;
	return (
		<div className="flex w-full flex-col gap-5 py-20 pr-28 pl-32">
			<div className="flex items-end gap-4">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<h1 className="text-[22px] leading-tight font-bold text-foreground">
						Emojis
					</h1>
					<p className="text-[13px] text-muted-foreground">
						{emojis?.length ?? 0} de {MAX}. No chat, escreva{" "}
						<code className="font-mono text-foreground">:nome:</code> ou escolha
						no seletor, na categoria do grupo.
					</p>
				</div>
				<Button
					disabled={full || chosen !== null}
					title={full ? "O grupo já tem 100 emojis." : undefined}
					onClick={() => input.current?.click()}
				>
					<SmilePlusIcon className="size-4" />
					Enviar emoji
				</Button>
				<input
					ref={input}
					type="file"
					accept="image/png,image/jpeg,image/webp,image/gif"
					aria-label="Escolher a imagem do emoji"
					className="hidden"
					onChange={choose}
				/>
			</div>
			<p className="-mt-2 text-xs text-muted-foreground">
				PNG, JPEG ou WebP viram 128×128. GIF animado vai como está, até 256 KB.
			</p>
			{problem && (
				<p role="alert" className="text-[13px] text-destructive-text">
					{problem}
				</p>
			)}
			{chosen && (
				<NewEmoji
					key={`${chosen.name}:${chosen.lastModified}`}
					file={chosen}
					onDone={() => setChosen(null)}
				/>
			)}
			{emojis === null ? (
				<LoadingState className="py-16" />
			) : emojis.length === 0 ? (
				<EmptyState
					className="py-16"
					icon={<SmilePlusIcon />}
					title="Nenhum emoji ainda"
					description="Os emojis do grupo aparecem aqui."
				/>
			) : (
				<ul
					aria-label="Emojis do grupo"
					className="overflow-hidden rounded-xl border border-border bg-card"
				>
					{emojis.map((emoji) => (
						<EmojiRow key={emoji.id} emoji={emoji} />
					))}
				</ul>
			)}
		</div>
	);
}

/** O emoji escolhido, com o nome antes de salvar. */
function NewEmoji({ file, onDone }: { file: File; onDone: () => void }) {
	const [name, setName] = useState(() => nameFromFile(file.name));
	const [preview, setPreview] = useState<string | null>(null);
	const create = useCreateEmoji();
	const nameProblem = name ? emojiNameProblem(name) : null;

	useEffect(() => {
		const url = URL.createObjectURL(file);
		setPreview(url);
		return () => URL.revokeObjectURL(url);
	}, [file]);

	return (
		<form
			aria-label="Novo emoji"
			className="flex items-start gap-4 rounded-xl border border-border bg-card p-4"
			onSubmit={(event) => {
				event.preventDefault();
				if (nameProblem || !name) return;
				create.mutate({ file, name }, { onSuccess: onDone });
			}}
		>
			<div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-background">
				{preview && (
					<img src={preview} alt="" className="size-12 object-contain" />
				)}
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-2">
				<TextField
					label="Nome"
					value={name}
					maxLength={32}
					showCount
					autoFocus
					onChange={(event) => setName(event.target.value.toLowerCase())}
					error={
						nameProblem ?? (create.isError ? message(create.error) : undefined)
					}
					description="Como se escreve no chat, entre dois-pontos."
				/>
				<div className="flex gap-2">
					<Button type="submit" disabled={!name || !!nameProblem || create.isPending}>
						{create.isPending ? "Enviando…" : "Salvar"}
					</Button>
					<Button
						type="button"
						variant="ghost"
						disabled={create.isPending}
						onClick={onDone}
					>
						Cancelar
					</Button>
				</div>
			</div>
		</form>
	);
}

function EmojiRow({ emoji }: { emoji: Emoji }) {
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(emoji.name);
	const [confirming, setConfirming] = useState(false);
	const rename = useRenameEmoji();
	const remove = useDeleteEmoji();
	const nameProblem = editing ? emojiNameProblem(name) : null;
	const error = rename.error ?? remove.error;

	return (
		<li className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
			<CustomEmoji emoji={emoji} className="size-8" />
			{editing ? (
				<form
					aria-label={`Renomear :${emoji.name}:`}
					className="flex min-w-0 flex-1 items-center gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						if (nameProblem) return;
						if (name === emoji.name) {
							setEditing(false);
							return;
						}
						rename.mutate(
							{ id: emoji.id, name },
							{ onSuccess: () => setEditing(false) },
						);
					}}
				>
					<input
						aria-label="Nome novo"
						value={name}
						maxLength={32}
						autoFocus
						onChange={(event) => setName(event.target.value.toLowerCase())}
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								event.preventDefault();
								setName(emoji.name);
								setEditing(false);
							}
						}}
						className="h-8 min-w-0 flex-1 rounded-md border border-border-strong bg-background px-2 font-mono text-[13px] text-foreground focus-visible:border-focus focus-visible:outline-none"
					/>
					<Button
						type="submit"
						size="sm"
						disabled={!!nameProblem || rename.isPending}
					>
						Salvar
					</Button>
				</form>
			) : (
				<span className="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground">
					:{emoji.name}:
				</span>
			)}
			{(nameProblem || error) && (
				<span role="alert" className="text-xs text-destructive-text">
					{nameProblem ?? message(error)}
				</span>
			)}
			{!editing &&
				(confirming ? (
					<>
						<span className="text-xs text-muted-foreground">
							As reações com ele também saem.
						</span>
						<Button
							size="sm"
							variant="danger"
							disabled={remove.isPending}
							onClick={() => remove.mutate(emoji.id)}
						>
							Excluir
						</Button>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => setConfirming(false)}
						>
							Cancelar
						</Button>
					</>
				) : (
					<>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => {
								setName(emoji.name);
								setEditing(true);
							}}
						>
							Renomear
						</Button>
						<Button
							size="sm"
							variant="ghost"
							aria-label={`Excluir :${emoji.name}:`}
							onClick={() => setConfirming(true)}
						>
							Excluir
						</Button>
					</>
				))}
		</li>
	);
}
