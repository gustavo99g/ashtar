import { AudioLinesIcon } from "lucide-react";
import { useSoundPlaying } from "@/features/sounds";
import { cn } from "@/lib/utils";

/**
 * A onda dourada de quem está tocando um som (v0.9, ADR 0037), na lista da sala e no bloco. Sem o
 * nome do som: só mostra quem tocou.
 */
export function SoundWave({
	userId,
	className,
}: {
	userId: string;
	className?: string;
}) {
	const playing = useSoundPlaying(userId);
	if (!playing) return null;
	return (
		<AudioLinesIcon
			role="img"
			aria-label="tocando um som"
			className={cn("shrink-0 animate-pulse text-gold", className)}
		/>
	);
}
