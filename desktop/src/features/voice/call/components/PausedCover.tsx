import { PauseIcon } from "lucide-react";

/*
 * Por cima da imagem de uma transmissão pausada. Quem transmite pausa silenciando a trilha de
 * vídeo (`publisher.rs`): a última imagem fica parada, e este aviso diz por quê.
 */
export function PausedCover({ compact = false }: { compact?: boolean }) {
	return (
		<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-rail/80 text-center">
			<PauseIcon
				aria-hidden="true"
				className={
					compact ? "size-5 text-foreground" : "size-8 text-foreground"
				}
			/>
			<span
				className={
					compact
						? "text-xs font-semibold text-foreground"
						: "text-sm font-semibold text-foreground"
				}
			>
				Transmissão pausada
			</span>
		</div>
	);
}
