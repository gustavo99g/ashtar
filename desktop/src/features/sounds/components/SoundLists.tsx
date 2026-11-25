import { CheckIcon, PencilIcon, PlayIcon, Trash2Icon, XIcon } from "lucide-react";
import { type MouseEvent, type ReactNode, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { ApiError, fetchFile, type Sound } from "@/lib/api";
import { decodeSound, peaks, seconds } from "../model/audio";
import { playSoundFile } from "../model/player";
import {
	useDeleteSound,
	useReviewSound,
	useUpdateSound,
} from "../queries";
import { useSoundboard } from "../stores/soundboardPrefs";
import { soundNameProblem } from "./SoundEditor";
import { Waveform } from "./Waveform";

/*
 * As listas da tela Sons (quadros "Sons — Meus sons" e "Sons — Aprovação"): os que a pessoa
 * enviou, com a situação; a fila, com ouvir, Aprovar e Recusar com o motivo; e todos os aprovados,
 * com ouvir, renomear e excluir.
 */

const ROW = "flex items-center gap-4 px-4 py-3";

/** "hoje, 21:05" ou "18/11". `at` em segundos. */
export function when(at: number, now = Date.now()): string {
	const date = new Date(at * 1000);
	const today = new Date(now);
	const pad = (n: number) => String(n).padStart(2, "0");
	if (date.toDateString() === today.toDateString()) {
		return `hoje, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
	}
	return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

function failed(what: string, error: unknown): void {
	toast.add({
		title: `Não deu para ${what}`,
		description:
			error instanceof ApiError || error instanceof Error
				? error.message
				: "Tente de novo em instantes.",
		data: { tone: "error" },
	});
}

function listen(sound: Sound): void {
	void playSoundFile(sound.file_id, useSoundboard.getState().volume / 100);
}

function SoundIcon({ sound }: { sound: Sound }) {
	return (
		<span
			aria-hidden="true"
			className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-lg"
		>
			{sound.emoji ?? "🔊"}
		</span>
	);
}

function IconButton({
	label,
	onClick,
	children,
	danger = false,
}: {
	label: string;
	onClick: (event: MouseEvent) => void;
	children: ReactNode;
	danger?: boolean;
}) {
	return (
		<Button
			variant="ghost"
			size="icon"
			aria-label={label}
			title={label}
			onClick={onClick}
			className={danger ? "hover:text-destructive-text" : undefined}
		>
			{children}
		</Button>
	);
}

function StatusBadge({ sound }: { sound: Sound }) {
	if (sound.status === "pending") return <Badge tone="gold">Aguardando</Badge>;
	if (sound.status === "rejected") return <Badge tone="danger">Recusado</Badge>;
	return <Badge tone="success">Aprovado</Badge>;
}

/** "Meus sons": o que a pessoa enviou. */
export function MySoundList({
	sounds,
	onEdit,
}: {
	sounds: Sound[];
	/** "Editar e reenviar" de um som aguardando ou recusado. */
	onEdit: (sound: Sound) => void;
}) {
	const remove = useDeleteSound();
	return (
		<ul
			aria-label="Enviados por você"
			className="overflow-hidden rounded-xl border border-border bg-card [&>*+*]:border-t [&>*+*]:border-border"
		>
			{sounds.map((sound) => (
				<li key={sound.id} className={ROW}>
					<SoundIcon sound={sound} />
					<span className="flex min-w-0 flex-1 flex-col">
						<span className="truncate text-sm font-semibold text-foreground">
							{sound.name}
						</span>
						<span
							className={
								sound.status === "rejected"
									? "truncate text-xs text-destructive-text"
									: "truncate text-xs text-muted-foreground"
							}
						>
							{sound.status === "rejected"
								? sound.reason
									? `Recusado: "${sound.reason}"`
									: "Recusado, sem motivo"
								: sound.status === "approved"
									? `aprovado em ${when(sound.reviewed_at ?? sound.created_at)}`
									: `enviado ${when(sound.created_at)}`}
						</span>
					</span>
					<span className="font-mono text-xs text-muted-foreground">
						{seconds(sound.duration_ms / 1000)}
					</span>
					<span className="w-24">
						<StatusBadge sound={sound} />
					</span>
					<span className="flex w-28 justify-end">
						<IconButton label={`Ouvir ${sound.name}`} onClick={() => listen(sound)}>
							<PlayIcon />
						</IconButton>
						{sound.status !== "approved" && (
							<IconButton
								label={`Editar e reenviar ${sound.name}`}
								onClick={() => onEdit(sound)}
							>
								<PencilIcon />
							</IconButton>
						)}
						{sound.status === "pending" && (
							<IconButton
								label={`Cancelar ${sound.name}`}
								onClick={() =>
									remove.mutate(sound.id, {
										onError: (error) => failed("cancelar o envio", error),
									})
								}
							>
								<XIcon />
							</IconButton>
						)}
						{sound.status === "rejected" && (
							<IconButton
								danger
								label={`Apagar ${sound.name}`}
								onClick={() =>
									remove.mutate(sound.id, {
										onError: (error) => failed("apagar o som", error),
									})
								}
							>
								<Trash2Icon />
							</IconButton>
						)}
					</span>
				</li>
			))}
		</ul>
	);
}

/** As barras de um som do servidor, para a fila. Sem Web Audio (ou falhando), nenhuma. */
function useSoundBars(fileId: string, count: number): number[] {
	const [bars, setBars] = useState<number[]>([]);
	useEffect(() => {
		let alive = true;
		fetchFile(fileId)
			.then(decodeSound)
			.then((samples) => alive && setBars(peaks(samples, count)))
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [fileId, count]);
	return bars;
}

/** "Aprovação": a fila, cada som com ouvir, Aprovar e Recusar. */
export function PendingSoundList({ sounds }: { sounds: Sound[] }) {
	return (
		<ul aria-label="Aguardando aprovação" className="flex flex-col gap-4">
			{sounds.map((sound) => (
				<PendingCard key={sound.id} sound={sound} />
			))}
		</ul>
	);
}

function PendingCard({ sound }: { sound: Sound }) {
	const review = useReviewSound();
	const [rejecting, setRejecting] = useState(false);
	const [reason, setReason] = useState("");
	const bars = useSoundBars(sound.file_id, 100);

	function decide(approve: boolean) {
		review.mutate(
			{ id: sound.id, approve, reason: reason.trim() || undefined },
			{
				onError: (error) =>
					failed(approve ? "aprovar o som" : "recusar o som", error),
			},
		);
	}

	return (
		<li
			className={
				rejecting
					? "flex flex-col gap-3 rounded-xl border border-destructive-border bg-card p-4"
					: "flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
			}
		>
			<div className="flex items-center gap-3">
				<SoundIcon sound={sound} />
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="truncate text-sm font-semibold text-foreground">
						{sound.name}
					</span>
					<span className="truncate text-xs text-muted-foreground">
						enviado por{" "}
						<strong className="text-foreground">{sound.uploader_name}</strong> ·{" "}
						{when(sound.created_at)}
					</span>
				</span>
				<span className="font-mono text-xs text-muted-foreground">
					{seconds(sound.duration_ms / 1000)}
				</span>
			</div>
			<div className="flex items-center gap-3">
				<Button
					size="icon"
					className="shrink-0 rounded-full"
					aria-label={`Ouvir ${sound.name}`}
					onClick={() => listen(sound)}
				>
					<PlayIcon />
				</Button>
				<Waveform bars={bars} className="h-10 flex-1" />
			</div>
			{rejecting ? (
				<>
					<label className="flex flex-col gap-1.5">
						<span className="text-xs font-bold tracking-[0.06em] text-muted-foreground uppercase">
							Motivo (opcional, {sound.uploader_name} vai ver)
						</span>
						<Input
							aria-label="Motivo da recusa"
							value={reason}
							maxLength={200}
							onChange={(event) => setReason(event.target.value)}
						/>
					</label>
					<div className="flex justify-end gap-2">
						<Button variant="ghost" onClick={() => setRejecting(false)}>
							Voltar
						</Button>
						<Button
							variant="danger"
							disabled={review.isPending}
							onClick={() => decide(false)}
						>
							Recusar som
						</Button>
					</div>
				</>
			) : (
				<div className="flex justify-end gap-2">
					<Button variant="outline" onClick={() => setRejecting(true)}>
						<XIcon />
						Recusar
					</Button>
					<Button
						className="bg-success text-white hover:brightness-110 disabled:bg-secondary"
						disabled={review.isPending}
						onClick={() => decide(true)}
					>
						<CheckIcon />
						Aprovar
					</Button>
				</div>
			)}
		</li>
	);
}

/** "Todos os sons": os aprovados, com ouvir, renomear e excluir. */
export function AllSoundList({ sounds }: { sounds: Sound[] }) {
	const remove = useDeleteSound();
	const [confirm, setConfirm] = useState<Sound | null>(null);
	const [editing, setEditing] = useState<string | null>(null);

	function removeNow(sound: Sound) {
		setConfirm(null);
		remove.mutate(sound.id, {
			onError: (error) => failed("excluir o som", error),
		});
	}

	return (
		<>
			<ul
				aria-label="Sons do grupo"
				className="overflow-hidden rounded-xl border border-border bg-card [&>*+*]:border-t [&>*+*]:border-border"
			>
				{sounds.map((sound) =>
					editing === sound.id ? (
						<RenameRow
							key={sound.id}
							sound={sound}
							onDone={() => setEditing(null)}
						/>
					) : (
						<li key={sound.id} className={ROW}>
							<SoundIcon sound={sound} />
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="truncate text-sm font-semibold text-foreground">
									{sound.name}
								</span>
								<span className="truncate text-xs text-muted-foreground">
									enviado por {sound.uploader_name}
								</span>
							</span>
							<span className="font-mono text-xs text-muted-foreground">
								{seconds(sound.duration_ms / 1000)}
							</span>
							<span className="flex justify-end">
								<IconButton
									label={`Ouvir ${sound.name}`}
									onClick={() => listen(sound)}
								>
									<PlayIcon />
								</IconButton>
								<IconButton
									label={`Renomear ${sound.name}`}
									onClick={() => setEditing(sound.id)}
								>
									<PencilIcon />
								</IconButton>
								<IconButton
									danger
									label={`Excluir ${sound.name}`}
									onClick={(event) =>
										// Segurar Shift pula a pergunta, como no excluir mensagem.
										event.shiftKey ? removeNow(sound) : setConfirm(sound)
									}
								>
									<Trash2Icon />
								</IconButton>
							</span>
						</li>
					),
				)}
			</ul>
			<Dialog
				open={confirm !== null}
				onOpenChange={(open) => !open && setConfirm(null)}
			>
				<DialogContent>
					<DialogTitle>Excluir "{confirm?.name}"?</DialogTitle>
					<DialogDescription>
						O som sai da grade de todo mundo, e o lugar de quem tinha ele fica
						vazio. Não dá para desfazer.
					</DialogDescription>
					<p className="text-xs text-muted-foreground">
						Segure Shift para pular esta confirmação.
					</p>
					<DialogFooter>
						<DialogClose render={<Button variant="ghost" />}>Cancelar</DialogClose>
						<Button
							variant="danger"
							onClick={() => confirm && removeNow(confirm)}
						>
							Excluir
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

function RenameRow({ sound, onDone }: { sound: Sound; onDone: () => void }) {
	const update = useUpdateSound();
	const [name, setName] = useState(sound.name);
	const [emoji, setEmoji] = useState(sound.emoji ?? "");
	const problem = soundNameProblem(name);
	return (
		<li>
			<form
				aria-label={`Renomear ${sound.name}`}
				className={ROW}
				onSubmit={(event) => {
					event.preventDefault();
					if (problem) return;
					update.mutate(
						{ id: sound.id, name: name.trim(), emoji: emoji.trim() || null },
						{
							onSuccess: onDone,
							onError: (error) => failed("renomear o som", error),
						},
					);
				}}
			>
				<Input
					aria-label="Emoji do som"
					value={emoji}
					maxLength={16}
					placeholder="🔊"
					onChange={(event) => setEmoji(event.target.value)}
					className="w-12 text-center text-lg"
				/>
				<Input
					aria-label="Nome do som"
					value={name}
					autoFocus
					onChange={(event) => setName(event.target.value)}
					className="flex-1"
				/>
				<Button type="button" variant="ghost" onClick={onDone}>
					Cancelar
				</Button>
				<Button type="submit" disabled={problem !== null || update.isPending}>
					Salvar
				</Button>
			</form>
		</li>
	);
}
