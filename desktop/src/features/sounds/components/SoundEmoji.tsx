import { CustomEmoji, customId, useEmojiById } from "@/features/emojis";
import { cn } from "@/lib/utils";

/**
 * O emoji de um som: um comum (o texto) ou um do grupo (`c:<id>`, a imagem). Sem emoji, ou com um
 * do grupo que foi excluído, fica o 🔊.
 */
export function SoundEmoji({
	emoji,
	className,
}: {
	emoji: string | null;
	/** O tamanho da imagem de um emoji do grupo (por padrão, o da letra). */
	className?: string;
}) {
	const byId = useEmojiById();
	const id = emoji ? customId(emoji) : null;
	if (id !== null) {
		const custom = byId.get(id);
		return custom ? (
			<CustomEmoji emoji={custom} className={cn("align-middle", className)} />
		) : (
			<>🔊</>
		);
	}
	return <>{emoji || "🔊"}</>;
}
