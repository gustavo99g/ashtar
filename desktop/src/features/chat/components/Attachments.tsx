/**
 * Os anexos de uma mensagem (decisão 21 do plano da v0.7): a imagem pela miniatura, no tamanho
 * reservado antes de carregar, que abre o visualizador com o original; o resto, o cartão com o
 * tipo, o tamanho e Baixar. O Baixar é do Rust, direto para a pasta Downloads.
 *
 * Na mensagem que ainda está subindo (`PendingFiles`), os cartões mostram a barra de progresso.
 */
import { DownloadIcon, FileIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { ApiError, type FileView } from "@/lib/api";
import { useFileUrl } from "@/lib/fileCache";
import { downloadFile } from "@/lib/tauri/commands";
import { cn } from "@/lib/utils";
import { fileCaption, fitBox, isImage } from "../model/attachments";
import type { PendingFile } from "../stores/outboxStore";
import { FileThumb } from "./AttachmentDrafts";

/** O Baixar de um arquivo: o progresso (0 a 1, ou `null` sem o total) enquanto baixa. */
function useDownload(file: FileView) {
	const [progress, setProgress] = useState<number | null | undefined>();
	async function start() {
		if (progress !== undefined) return;
		setProgress(0);
		try {
			const path = await downloadFile(file.id, file.name, (p) =>
				setProgress(p.total ? p.received / p.total : null),
			);
			toast.add({ title: "Salvo em Downloads", description: path });
		} catch (error) {
			toast.add({
				title: `Não deu para baixar ${file.name}`,
				description:
					error instanceof ApiError ? error.message : "Tente de novo.",
			});
		} finally {
			setProgress(undefined);
		}
	}
	return { downloading: progress !== undefined, progress, start };
}

function ProgressBar({
	value,
	label,
}: {
	value: number | null | undefined;
	label: string;
}) {
	return (
		<div
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={value == null ? undefined : Math.round(value * 100)}
			className="h-1 w-full overflow-hidden rounded-full bg-border-strong"
		>
			<div
				className={cn(
					"h-full rounded-full bg-primary transition-[width]",
					value == null && "w-1/3 animate-pulse",
				)}
				style={value == null ? undefined : { width: `${value * 100}%` }}
			/>
		</div>
	);
}

/** O cartão de um arquivo que não é imagem: o ícone, o nome, "vídeo · 48 MB" e Baixar. */
function FileCard({ file }: { file: FileView }) {
	const download = useDownload(file);
	return (
		<div className="flex w-[min(100%,420px)] items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
			<FileIcon aria-hidden="true" className="size-8 shrink-0 text-link" />
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate text-sm font-medium text-foreground" title={file.name}>
					{file.name}
				</span>
				{download.downloading ? (
					<ProgressBar value={download.progress} label={`Baixando ${file.name}`} />
				) : (
					<span className="text-xs text-muted-foreground">
						{fileCaption(file.mime, file.name, file.size)}
					</span>
				)}
			</div>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={`Baixar ${file.name}`}
				title="Baixar"
				disabled={download.downloading}
				onClick={() => void download.start()}
			>
				<DownloadIcon />
			</Button>
		</div>
	);
}

/** O visualizador: o original, grande, com o nome e Baixar. */
function ImageViewer({
	file,
	onClose,
}: {
	file: FileView | null;
	onClose: () => void;
}) {
	return (
		<Dialog open={file !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="flex max-h-[calc(100vh-4rem)] w-auto max-w-[calc(100vw-4rem)] flex-col gap-3 bg-rail p-3 sm:max-w-[calc(100vw-4rem)]">
				{file && <ViewerContent file={file} />}
			</DialogContent>
		</Dialog>
	);
}

function ViewerContent({ file }: { file: FileView }) {
	const url = useFileUrl(file.id);
	const download = useDownload(file);
	return (
		<>
			<div className="flex items-center gap-2 pl-1">
				<DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium">
					{file.name}
				</DialogTitle>
				<Button
					variant="ghost"
					size="sm"
					disabled={download.downloading}
					onClick={() => void download.start()}
				>
					<DownloadIcon className="size-4" />
					Baixar
				</Button>
				<DialogClose
					render={<Button variant="ghost" size="icon-sm" aria-label="Fechar" />}
				>
					<XIcon />
				</DialogClose>
			</div>
			<div className="flex min-h-0 flex-1 items-center justify-center">
				{url ? (
					<img
						src={url}
						alt={file.name}
						className="max-h-[calc(100vh-9rem)] max-w-full rounded-md object-contain"
					/>
				) : (
					<div
						className="animate-pulse rounded-md bg-secondary"
						style={fitBox(file.width, file.height, { width: 640, height: 480 })}
					/>
				)}
			</div>
		</>
	);
}

/** Uma imagem no chat: a miniatura no espaço já reservado. */
function ImageAttachment({
	file,
	onOpen,
}: {
	file: FileView;
	onOpen: () => void;
}) {
	const url = useFileUrl(file.thumbnail_id ?? file.id);
	const box = fitBox(file.width, file.height);
	return (
		<button
			type="button"
			aria-label={`Abrir ${file.name}`}
			onClick={onOpen}
			className="block max-w-full overflow-hidden rounded-lg bg-secondary focus-visible:outline-2 focus-visible:outline-focus"
			style={{ width: box.width, aspectRatio: `${box.width} / ${box.height}` }}
		>
			{url && <img src={url} alt="" className="size-full object-cover" />}
		</button>
	);
}

export function Attachments({ files }: { files: readonly FileView[] }) {
	const [viewing, setViewing] = useState<FileView | null>(null);
	if (files.length === 0) return null;
	// A imagem sem miniatura não abriu no app de quem mandou: vai como arquivo.
	const images = files.filter(
		(file) => isImage(file.mime) && file.thumbnail_id,
	);
	const others = files.filter((file) => !images.includes(file));
	return (
		<div className="flex flex-col gap-1.5 pt-1">
			{images.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{images.map((file) => (
						<ImageAttachment
							key={file.id}
							file={file}
							onOpen={() => setViewing(file)}
						/>
					))}
				</div>
			)}
			{others.map((file) => (
				<FileCard key={file.id} file={file} />
			))}
			<ImageViewer file={viewing} onClose={() => setViewing(null)} />
		</div>
	);
}

/** Os anexos de uma mensagem que ainda está subindo, com a barra de cada um. */
export function PendingFiles({ files }: { files: readonly PendingFile[] }) {
	if (files.length === 0) return null;
	return (
		<ul aria-label="Arquivos enviando" className="flex flex-wrap gap-2 pt-1">
			{files.map(({ key, file, progress }) => (
				<li
					key={key}
					className="flex w-[220px] items-center gap-2.5 rounded-lg border border-border bg-card p-2"
				>
					<div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-background">
						<FileThumb file={file} />
					</div>
					<div className="flex min-w-0 flex-1 flex-col gap-1.5">
						<span className="truncate text-xs text-foreground">
							{file.name || "arquivo"}
						</span>
						<ProgressBar
							value={progress}
							label={`Enviando ${file.name || "o arquivo"}`}
						/>
					</div>
				</li>
			))}
		</ul>
	);
}
