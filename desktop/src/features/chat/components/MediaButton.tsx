/**
 * A mídia do canal (decisão 30 do plano da v0.7): o botão no cabeçalho abre uma caixa por cima do
 * chat, como a da busca e a das fixadas. Dois filtros: Imagens e vídeos, numa grade de miniaturas,
 * e Arquivos, numa lista com o nome, o tamanho, quem mandou, quando e Baixar. Da mais nova para a
 * mais velha, de 50 em 50. A imagem abre o visualizador com Ir até a mensagem; o vídeo vai até a
 * mensagem, onde toca. Vale também nas conversas privadas.
 */
import { DownloadIcon, FileIcon, ImagesIcon, PlayIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import type { ChannelFile, FileView, MediaFilter } from "@/lib/api";
import { useFileUrl } from "@/lib/fileCache";
import { cn } from "@/lib/utils";
import { durationLabel, fileCaption, isVideo } from "../model/attachments";
import { authorName, stampLabel } from "../model/messages";
import { useChannelFiles } from "../queries";
import { requestJump } from "../stores/jumpStore";
import { ImageViewer, ProgressBar, useDownload } from "./Attachments";

export function MediaButton({
	channelId,
	className,
}: {
	channelId: string;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const [filter, setFilter] = useState<MediaFilter>("media");
	const [viewing, setViewing] = useState<ChannelFile | null>(null);

	function jump(item: ChannelFile) {
		setOpen(false);
		setViewing(null);
		requestJump(channelId, item.message_id);
	}

	return (
		<>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger
					aria-label="Mídia do canal"
					title="Mídia"
					className={cn(
						"flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground data-popup-open:bg-secondary data-popup-open:text-foreground",
						className,
					)}
				>
					<ImagesIcon aria-hidden="true" className="size-4" />
				</PopoverTrigger>
				<PopoverContent
					align="end"
					className="max-h-[min(75vh,600px)] w-[min(460px,calc(100vw-2rem))] gap-0 overflow-hidden p-0"
				>
					<div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
						<PopoverTitle className="min-w-0 flex-1 truncate text-sm font-bold">
							Mídia
						</PopoverTitle>
						<Segmented
							aria-label="O que mostrar"
							value={filter}
							onValueChange={(value) => setFilter(value as MediaFilter)}
						>
							<SegmentedItem value="media">Imagens e vídeos</SegmentedItem>
							<SegmentedItem value="files">Arquivos</SegmentedItem>
						</Segmented>
					</div>
					<MediaList
						channelId={channelId}
						filter={filter}
						onOpen={(item) => {
							if (isVideo(item.file.mime)) {
								jump(item);
							} else {
								setOpen(false);
								setViewing(item);
							}
						}}
					/>
				</PopoverContent>
			</Popover>
			<ImageViewer
				file={viewing?.file ?? null}
				onClose={() => setViewing(null)}
				onJump={viewing ? () => jump(viewing) : undefined}
			/>
		</>
	);
}

function MediaList({
	channelId,
	filter,
	onOpen,
}: {
	channelId: string;
	filter: MediaFilter;
	onOpen: (item: ChannelFile) => void;
}) {
	const query = useChannelFiles(channelId, filter);
	if (query.isError) {
		return <Note>Não deu para carregar. Tente de novo.</Note>;
	}
	if (!query.files) {
		return (
			<div className="flex justify-center py-6">
				<Spinner />
			</div>
		);
	}
	if (query.files.length === 0) {
		return (
			<Note>
				{filter === "media"
					? "Nenhuma imagem ou vídeo por aqui ainda."
					: "Nenhum arquivo por aqui ainda."}
			</Note>
		);
	}
	return (
		<div className="flex min-h-0 flex-col overflow-y-auto">
			{filter === "media" ? (
				<ul
					aria-label="Imagens e vídeos"
					className="grid grid-cols-3 gap-1.5 p-3"
				>
					{query.files.map((item) => (
						<li key={`${item.message_id}:${item.file.id}`}>
							<Thumb item={item} onOpen={() => onOpen(item)} />
						</li>
					))}
				</ul>
			) : (
				<ul aria-label="Arquivos" className="flex flex-col gap-1.5 p-3">
					{query.files.map((item) => (
						<FileRow key={`${item.message_id}:${item.file.id}`} item={item} />
					))}
				</ul>
			)}
			{query.hasNextPage && (
				<button
					type="button"
					disabled={query.isFetchingNextPage}
					onClick={() => void query.fetchNextPage()}
					className="mx-3 mb-3 rounded-lg border border-border py-2 text-[13px] font-semibold text-link hover:bg-secondary disabled:opacity-60"
				>
					{query.isFetchingNextPage ? "Carregando…" : "Mais"}
				</button>
			)}
		</div>
	);
}

function Thumb({ item, onOpen }: { item: ChannelFile; onOpen: () => void }) {
	const url = useFileUrl(item.file.thumbnail_id);
	const video = isVideo(item.file.mime);
	return (
		<button
			type="button"
			aria-label={`${video ? "Ir até o vídeo" : "Abrir"} ${item.file.name}`}
			title={`${authorName(item.author)} · ${stampLabel(item.created_at)}`}
			onClick={onOpen}
			className="relative block aspect-square w-full overflow-hidden rounded-md bg-secondary focus-visible:outline-2 focus-visible:outline-focus"
		>
			{url && <img src={url} alt="" className="size-full object-cover" />}
			{video && (
				<span className="absolute inset-0 flex items-center justify-center">
					<span className="flex size-8 items-center justify-center rounded-full bg-black/60 text-white">
						<PlayIcon aria-hidden="true" className="size-4 fill-current" />
					</span>
				</span>
			)}
			{video && item.file.duration_ms != null && (
				<span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 font-mono text-[10px] text-white">
					{durationLabel(item.file.duration_ms)}
				</span>
			)}
		</button>
	);
}

function FileRow({ item }: { item: ChannelFile }) {
	const file: FileView = item.file;
	const download = useDownload(file);
	return (
		<li className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
			<FileIcon aria-hidden="true" className="size-7 shrink-0 text-link" />
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span
					className="truncate text-sm font-medium text-foreground"
					title={file.name}
				>
					{file.name}
				</span>
				{download.downloading ? (
					<ProgressBar value={download.progress} label={`Baixando ${file.name}`} />
				) : (
					<span className="truncate text-xs text-muted-foreground">
						{fileCaption(file.mime, file.name, file.size)} ·{" "}
						{authorName(item.author)} · {stampLabel(item.created_at)}
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
		</li>
	);
}

function Note({ children }: { children: string }) {
	return (
		<p className="px-4 py-6 text-center text-[13px] text-muted-foreground">
			{children}
		</p>
	);
}
