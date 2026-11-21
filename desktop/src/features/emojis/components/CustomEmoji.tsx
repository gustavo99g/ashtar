import type { Emoji } from "@/lib/api";
import { useFileUrl } from "@/lib/fileCache";
import { cn } from "@/lib/utils";

/**
 * Um emoji do grupo: a imagem, com `:nome:` no `title` e no texto alternativo. Enquanto a imagem
 * não chega, o espaço já fica reservado.
 */
export function CustomEmoji({
	emoji,
	className,
}: {
	emoji: Pick<Emoji, "name" | "file_id">;
	/** O tamanho (por padrão, o da letra). */
	className?: string;
}) {
	const url = useFileUrl(emoji.file_id);
	const label = `:${emoji.name}:`;
	return url ? (
		<img
			src={url}
			alt={label}
			title={label}
			draggable={false}
			className={cn("inline-block size-[1.375em] object-contain align-[-0.3em]", className)}
		/>
	) : (
		<span
			role="img"
			aria-label={label}
			title={label}
			className={cn("inline-block size-[1.375em] align-[-0.3em]", className)}
		/>
	);
}
