/**
 * Os cartões dos links da mensagem (decisão 22 do plano da v0.7), embaixo do texto: o site, o
 * título (que abre o link no navegador), a descrição e a imagem, que a API baixou e guardou (o IP
 * de quem lê não vai para o site). O autor tira os cartões no X, de vez.
 */
import { useQueryClient } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import type { MouseEvent } from "react";
import { toast } from "@/components/ui/toast";
import { ApiError, hidePreviews, type LinkPreview, type Message } from "@/lib/api";
import { useFileUrl } from "@/lib/fileCache";
import { openLink } from "@/lib/tauri/opener";
import { replaceMessage } from "../queries";

function PreviewCard({
	preview,
	onHide,
}: {
	preview: LinkPreview;
	onHide?: () => void;
}) {
	const image = useFileUrl(preview.image_id);
	const open = (event: MouseEvent) => {
		event.preventDefault();
		openLink(preview.url);
	};
	return (
		<article
			aria-label={preview.title ?? preview.url}
			className="group/preview relative flex w-[min(100%,432px)] flex-col gap-2 rounded-lg border-l-4 border-l-primary bg-card py-3 pr-4 pl-3.5"
		>
			{preview.site && (
				<span className="truncate text-xs text-muted-foreground">
					{preview.site}
				</span>
			)}
			{preview.title && (
				<a
					href={preview.url}
					onClick={open}
					onAuxClick={(event) => event.button === 1 && open(event)}
					className="line-clamp-2 text-[15px] leading-snug font-semibold text-link hover:underline"
				>
					{preview.title}
				</a>
			)}
			{preview.description && (
				<p className="line-clamp-3 text-sm leading-snug text-secondary-foreground">
					{preview.description}
				</p>
			)}
			{preview.image_id && (
				<button
					type="button"
					tabIndex={-1}
					aria-hidden="true"
					onClick={open}
					className="mt-1 block aspect-video w-full overflow-hidden rounded-md bg-secondary"
				>
					{image && <img src={image} alt="" className="size-full object-cover" />}
				</button>
			)}
			{onHide && (
				<button
					type="button"
					aria-label="Tirar as prévias"
					title="Tirar as prévias"
					onClick={onHide}
					className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full text-muted-foreground opacity-0 group-hover/preview:opacity-100 hover:bg-secondary hover:text-foreground focus-visible:opacity-100"
				>
					<XIcon className="size-3.5" />
				</button>
			)}
		</article>
	);
}

interface LinkPreviewsProps {
	message: Message;
	/** Quem lê é o autor: ganha o X. */
	mine: boolean;
}

export function LinkPreviews(props: LinkPreviewsProps) {
	if ((props.message.previews ?? []).length === 0) return null;
	return <PreviewList {...props} />;
}

function PreviewList({ message, mine }: LinkPreviewsProps) {
	const queryClient = useQueryClient();
	const previews = message.previews ?? [];

	async function hide() {
		try {
			replaceMessage(queryClient, await hidePreviews(message.id));
		} catch (error) {
			toast.add({
				title: "Não deu para tirar as prévias",
				description: error instanceof ApiError ? error.message : "Tente de novo.",
				data: { tone: "error" },
			});
		}
	}

	return (
		<div className="flex flex-col gap-1.5 pt-1">
			{previews.map((preview) => (
				<PreviewCard
					key={preview.url}
					preview={preview}
					onHide={mine ? () => void hide() : undefined}
				/>
			))}
		</div>
	);
}
