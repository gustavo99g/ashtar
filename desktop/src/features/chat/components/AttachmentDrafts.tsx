/**
 * Os arquivos escolhidos para a próxima mensagem, em cima do campo (o quadro "Chat — anexos antes
 * de enviar"): a miniatura (ou o ícone do tipo), o nome, o tamanho e o X para tirar.
 */
import { FileIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { fileSize, isImage } from "../model/attachments";
import { type DraftFile, removeDraftFile } from "../stores/attachmentStore";

/** Uma URL `blob:` do arquivo local enquanto o cartão existe. */
export function useLocalUrl(file: Blob | null): string | undefined {
	const [url, setUrl] = useState<string>();
	useEffect(() => {
		if (!file) return;
		const created = URL.createObjectURL(file);
		setUrl(created);
		return () => {
			URL.revokeObjectURL(created);
			setUrl(undefined);
		};
	}, [file]);
	return url;
}

export function FileThumb({ file }: { file: File }) {
	const url = useLocalUrl(isImage(file.type) ? file : null);
	return url ? (
		<img src={url} alt="" className="size-full object-cover" />
	) : (
		<FileIcon aria-hidden="true" className="size-6 text-muted-foreground" />
	);
}

export function AttachmentDrafts({
	channelId,
	files,
}: {
	channelId: string;
	files: readonly DraftFile[];
}) {
	if (files.length === 0) return null;
	return (
		<ul
			aria-label="Arquivos para enviar"
			className="flex gap-2 overflow-x-auto px-1 pt-2.5 pb-1"
		>
			{files.map(({ key, file }) => (
				<li
					key={key}
					className="relative flex w-[132px] shrink-0 flex-col gap-1.5 rounded-lg border border-border bg-card p-1.5"
				>
					<div className="flex h-[84px] items-center justify-center overflow-hidden rounded-md bg-background">
						<FileThumb file={file} />
					</div>
					<span className="truncate px-0.5 text-xs text-foreground" title={file.name}>
						{file.name || "arquivo"}
					</span>
					<span className="px-0.5 text-[11px] text-muted-foreground">
						{fileSize(file.size)}
					</span>
					<button
						type="button"
						aria-label={`Tirar ${file.name || "o arquivo"}`}
						onClick={() => removeDraftFile(channelId, key)}
						className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground shadow-sm hover:bg-destructive hover:text-destructive-foreground"
					>
						<XIcon className="size-3.5" />
					</button>
				</li>
			))}
		</ul>
	);
}
