/**
 * As fixadas (decisão 24 do plano da v0.7): a faixa "1 mensagem fixada · clique para ver" embaixo
 * do cabeçalho e, no clique, a caixa por cima do chat com as fixadas, da fixada mais recente para
 * a mais antiga, cada uma com Ir até a mensagem e, para quem pode, Desafixar.
 */
import { PinIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar } from "@/features/identity";
import { toast } from "@/components/ui/toast";
import { ApiError, type FileView, type Message } from "@/lib/api";
import { useFileUrl } from "@/lib/fileCache";
import { attachmentsLabel, isImage } from "../model/attachments";
import { ImageViewer } from "./Attachments";
import { plainText } from "../model/markdown";
import { authorName, stampLabel } from "../model/messages";
import { useMessageActions, usePins } from "../queries";
import { requestJump } from "../stores/jumpStore";
import type { MessageActionsValue } from "./messageContext";

function pinCount(count: number): string {
	return count === 1 ? "1 mensagem fixada" : `${count} mensagens fixadas`;
}

function PinnedItem({
	message,
	onUnpin,
	onJump,
	onOpenImage,
}: {
	message: Message;
	/** Desafixar; sem isto (quem não pode), o botão não aparece. */
	onUnpin?: () => void;
	onJump: () => void;
	onOpenImage: (file: FileView) => void;
}) {
	const images = (message.attachments ?? []).filter(
		(file) => isImage(file.mime) && file.thumbnail_id,
	);
	const text =
		plainText(message.body) ||
		(images.length > 0 ? "" : attachmentsLabel(message.attachments ?? []));
	return (
		<li className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3">
			<div className="flex items-center gap-2">
				<Avatar
					nick={message.author.nick}
					displayName={message.author.display_name}
					avatar={message.author.avatar}
					size={22}
				/>
				<span className="truncate text-sm font-semibold text-foreground">
					{authorName(message.author)}
				</span>
				<span className="shrink-0 text-xs text-muted-foreground">
					{stampLabel(message.created_at)}
				</span>
			</div>
			{text && (
				<p className="line-clamp-3 text-sm whitespace-pre-wrap text-secondary-foreground">
					{text}
				</p>
			)}
			{images.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{images.map((file) => (
						<PinnedImage
							key={file.id}
							file={file}
							onOpen={() => onOpenImage(file)}
						/>
					))}
				</div>
			)}
			<div className="flex gap-3 text-xs font-semibold">
				<button
					type="button"
					onClick={onJump}
					className="text-link hover:underline"
				>
					Ir até a mensagem
				</button>
				{onUnpin && (
					<button
						type="button"
						onClick={onUnpin}
						className="text-muted-foreground hover:text-foreground hover:underline"
					>
						Desafixar
					</button>
				)}
			</div>
		</li>
	);
}

/** A miniatura de uma imagem da fixada; o clique abre o visualizador. */
function PinnedImage({ file, onOpen }: { file: FileView; onOpen: () => void }) {
	const url = useFileUrl(file.thumbnail_id ?? file.id);
	return (
		<button
			type="button"
			aria-label={`Abrir ${file.name}`}
			onClick={onOpen}
			className="h-20 overflow-hidden rounded-md bg-secondary focus-visible:outline-2 focus-visible:outline-focus"
			style={{
				aspectRatio:
					file.width && file.height
						? `${file.width} / ${file.height}`
						: "4 / 3",
				maxWidth: "100%",
			}}
		>
			{url && <img src={url} alt="" className="size-full object-cover" />}
		</button>
	);
}

export function PinsBar({
	channelId,
	actions,
	compact,
}: {
	channelId: string;
	actions: MessageActionsValue;
	compact: boolean;
}) {
	const pins = usePins(channelId).data ?? [];
	const [open, setOpen] = useState(false);
	if (pins.length === 0) return null;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				aria-label={`${pinCount(pins.length)} · clique para ver`}
				className={cn(
					"flex w-full shrink-0 items-center gap-2 border-b border-border bg-card py-2 text-left text-[13px] text-muted-foreground hover:bg-secondary",
					compact ? "px-3" : "px-4",
				)}
			>
				<PinIcon aria-hidden="true" className="size-3.5 shrink-0 text-link" />
				<span className="truncate">
					<strong className="font-semibold text-foreground">
						{pinCount(pins.length)}
					</strong>{" "}
					· clique para ver
				</span>
			</PopoverTrigger>
			<PinsPopup
				pins={pins}
				align="start"
				onUnpin={
					actions.canPin ? (message) => actions.pin(message, false) : undefined
				}
				onJump={(message) => {
					setOpen(false);
					actions.jumpTo(message.id);
				}}
			/>
		</Popover>
	);
}

/** A caixa das fixadas, da faixa e do botão do cabeçalho. */
function PinsPopup({
	pins,
	align,
	onUnpin,
	onJump,
}: {
	pins: readonly Message[];
	align: "start" | "end";
	onUnpin?: (message: Message) => void;
	onJump: (message: Message) => void;
}) {
	// Fora da caixa: o visualizador continua aberto mesmo se a caixa fechar.
	const [viewing, setViewing] = useState<FileView | null>(null);
	return (
		<>
			<ImageViewer file={viewing} onClose={() => setViewing(null)} />
			<PopoverContent
				align={align}
				className="max-h-[min(70vh,520px)] w-[min(420px,calc(100vw-2rem))] overflow-hidden p-0"
			>
				<PopoverTitle className="border-b border-border px-4 py-3 text-sm font-bold">
					Mensagens fixadas
				</PopoverTitle>
				{pins.length === 0 ? (
					<p className="px-4 pb-5 text-center text-[13px] text-muted-foreground">
						Nenhuma mensagem fixada neste canal.
					</p>
				) : (
					<ul className="flex flex-col gap-2 overflow-y-auto px-3 pb-3">
						{pins.map((message) => (
							<PinnedItem
								key={message.id}
								message={message}
								onUnpin={onUnpin && (() => onUnpin(message))}
								onJump={() => onJump(message)}
								onOpenImage={setViewing}
							/>
						))}
					</ul>
				)}
			</PopoverContent>
		</>
	);
}

/**
 * O botão das fixadas no cabeçalho (o quadro "Canal de texto — paleta Ashtar"): abre a mesma caixa
 * da faixa, também quando não há nenhuma.
 */
export function PinsButton({
	channelId,
	canPin,
}: {
	channelId: string;
	canPin: boolean;
}) {
	const pins = usePins(channelId).data ?? [];
	const [open, setOpen] = useState(false);
	const { pin } = useMessageActions();
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				aria-label="Mensagens fixadas"
				title="Mensagens fixadas"
				className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground data-popup-open:bg-secondary data-popup-open:text-foreground"
			>
				<PinIcon aria-hidden="true" className="size-[18px]" />
			</PopoverTrigger>
			<PinsPopup
				pins={pins}
				align="end"
				onUnpin={
					canPin
						? (message) =>
								void pin(message, false).catch((error: unknown) =>
									toast.add({
										title: "Não deu para desafixar",
										description:
											error instanceof ApiError
												? error.message
												: "Tente de novo.",
									}),
								)
						: undefined
				}
				onJump={(message) => {
					setOpen(false);
					requestJump(channelId, message.id);
				}}
			/>
		</Popover>
	);
}
