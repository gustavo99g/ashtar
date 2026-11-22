/**
 * Os anexos de uma mensagem (decisão 21 do plano da v0.7): a imagem pela miniatura, no tamanho
 * reservado antes de carregar, que abre o visualizador com o original; o resto, o cartão com o
 * tipo, o tamanho e Baixar. O Baixar é do Rust, direto para a pasta Downloads.
 *
 * Na mensagem que ainda está subindo (`PendingFiles`), os cartões mostram a barra de progresso.
 */
import {
	CopyIcon,
	DownloadIcon,
	FileIcon,
	PlayIcon,
	XIcon,
} from "lucide-react";
import { useState } from "react";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { ApiError, apiUrl, type FileView, fileLink } from "@/lib/api";
import { useFileUrl } from "@/lib/fileCache";
import { downloadFile } from "@/lib/tauri/commands";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { copyImageFile } from "../model/copyImage";
import { cn } from "@/lib/utils";
import {
	durationLabel,
	fileCaption,
	fitBox,
	isImage,
	isVideo,
} from "../model/attachments";
import type { PendingFile } from "../stores/outboxStore";
import { FileThumb } from "./AttachmentDrafts";

/** O Baixar de um arquivo: o progresso (0 a 1, ou `null` sem o total) enquanto baixa. */
export function useDownload(file: FileView) {
	const [progress, setProgress] = useState<number | null | undefined>();
	async function start() {
		if (progress !== undefined) return;
		setProgress(0);
		try {
			const path = await downloadFile(file.id, file.name, (p) =>
				setProgress(p.total ? p.received / p.total : null),
			);
			toast.add({
				title: "Salvo em Downloads",
				description: path,
				data: { tone: "success", compact: true },
			});
		} catch (error) {
			toast.add({
				title: `Não deu para baixar ${file.name}`,
				description:
					error instanceof ApiError ? error.message : "Tente de novo.",
				data: { tone: "error" },
			});
		} finally {
			setProgress(undefined);
		}
	}
	return { downloading: progress !== undefined, progress, start };
}

/** Copia a imagem e avisa como foi. */
export function copyImage(file: FileView): void {
	copyImageFile(file.id).then(
		() =>
			toast.add({
				title: "Imagem copiada",
				data: { tone: "success", compact: true },
			}),
		() =>
			toast.add({
				title: "Não deu para copiar a imagem",
				description: "Tente de novo.",
				data: { tone: "error" },
			}),
	);
}

/** Copiar imagem e Baixar, no botão direito de uma imagem (no chat e no visualizador). */
export function ImageMenuItems({ file }: { file: FileView }) {
	const download = useDownload(file);
	return (
		<>
			<DropdownMenuItem onClick={() => copyImage(file)}>
				<CopyIcon />
				Copiar imagem
			</DropdownMenuItem>
			<DropdownMenuItem onClick={() => void download.start()}>
				<DownloadIcon />
				Baixar imagem
			</DropdownMenuItem>
		</>
	);
}

export function ProgressBar({
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
				<span
					className="truncate text-sm font-medium text-foreground"
					title={file.name}
				>
					{file.name}
				</span>
				{download.downloading ? (
					<ProgressBar
						value={download.progress}
						label={`Baixando ${file.name}`}
					/>
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

/**
 * O visualizador: o original, grande, com o nome e Baixar. Aberto da mídia do canal, também com
 * Ir até a mensagem (`onJump`).
 */
export function ImageViewer({
	file,
	onClose,
	onJump,
}: {
	file: FileView | null;
	onClose: () => void;
	onJump?: () => void;
}) {
	return (
		<Dialog open={file !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="flex max-h-[calc(100vh-4rem)] w-auto max-w-[calc(100vw-4rem)] flex-col gap-3 bg-rail p-3 sm:max-w-[calc(100vw-4rem)]">
				{file && <ViewerContent file={file} onJump={onJump} />}
			</DialogContent>
		</Dialog>
	);
}

function ViewerContent({
	file,
	onJump,
}: {
	file: FileView;
	onJump?: () => void;
}) {
	const url = useFileUrl(file.id);
	const download = useDownload(file);
	return (
		<>
			<div className="flex items-center gap-2 pl-1">
				<DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium">
					{file.name}
				</DialogTitle>
				{onJump && (
					<Button variant="ghost" size="sm" onClick={onJump}>
						Ir até a mensagem
					</Button>
				)}
				<Button variant="ghost" size="sm" onClick={() => copyImage(file)}>
					<CopyIcon className="size-4" />
					Copiar
				</Button>
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
					<ContextMenu>
						<ContextMenuTrigger
							render={
								<img
									src={url}
									alt={file.name}
									className="max-h-[calc(100vh-9rem)] max-w-full rounded-md object-contain"
								/>
							}
						/>
						<ContextMenuContent aria-label={file.name}>
							<ImageMenuItems file={file} />
						</ContextMenuContent>
					</ContextMenu>
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
			data-image-id={file.id}
			onClick={onOpen}
			className="block max-w-full overflow-hidden rounded-lg bg-secondary focus-visible:outline-2 focus-visible:outline-focus"
			style={{ width: box.width, aspectRatio: `${box.width} / ${box.height}` }}
		>
			{url && <img src={url} alt="" className="size-full object-cover" />}
		</button>
	);
}

/** O vídeo tocando agora: um de cada vez (decisão 28). */
const usePlaying = create<{ id: string | null }>(() => ({ id: null }));

/**
 * Um vídeo no chat: a capa com o play no espaço reservado; o play pede o link curto e toca ali
 * mesmo, sem som até a pessoa ligar, com os controles do WebView. Começar outro para este.
 */
function VideoAttachment({ file }: { file: FileView }) {
	const cover = useFileUrl(file.thumbnail_id);
	const playing = usePlaying((state) => state.id === file.id);
	const [src, setSrc] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const box = fitBox(file.width, file.height);

	async function play() {
		if (loading) return;
		setLoading(true);
		try {
			const link = await fileLink(file.id);
			setSrc(apiUrl(link.path));
			usePlaying.setState({ id: file.id });
		} catch (error) {
			toast.add({
				title: `Não deu para tocar ${file.name}`,
				description:
					error instanceof ApiError ? error.message : "Tente de novo.",
				data: { tone: "error" },
			});
		} finally {
			setLoading(false);
		}
	}

	const style = {
		width: box.width,
		aspectRatio: `${box.width} / ${box.height}`,
	};
	if (playing && src) {
		return (
			<video
				src={src}
				controls
				autoPlay
				muted
				aria-label={file.name}
				onPlay={() => usePlaying.setState({ id: file.id })}
				className="block max-w-full rounded-lg bg-black"
				style={style}
			/>
		);
	}
	return (
		<button
			type="button"
			aria-label={`Tocar ${file.name}`}
			onClick={() => void play()}
			className="group/video relative block max-w-full overflow-hidden rounded-lg bg-black focus-visible:outline-2 focus-visible:outline-focus"
			style={style}
		>
			{cover && <img src={cover} alt="" className="size-full object-cover" />}
			<span className="absolute inset-0 flex items-center justify-center">
				<span className="flex size-12 items-center justify-center rounded-full bg-black/60 text-white group-hover/video:bg-black/80">
					<PlayIcon
						className={cn("size-6 fill-current", loading && "animate-pulse")}
					/>
				</span>
			</span>
			{file.duration_ms != null && (
				<span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white">
					{durationLabel(file.duration_ms)}
				</span>
			)}
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
	const videos = files.filter((file) => isVideo(file.mime));
	const others = files.filter(
		(file) => !images.includes(file) && !videos.includes(file),
	);
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
			{videos.map((file) => (
				<VideoAttachment key={file.id} file={file} />
			))}
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
