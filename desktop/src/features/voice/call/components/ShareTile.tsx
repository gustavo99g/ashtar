import { MonitorPlayIcon } from "lucide-react";
import type { ReactNode } from "react";
import { LiveBadge } from "./LiveBadge";

/*
 * O lugar de uma transmissão na Grade: quem está transmitindo, o que é (o título da janela ou da
 * tela) e o botão para assistir. A imagem de quem assiste só aparece no Foco; a própria
 * transmissão mostra a miniatura ao vivo (`preview`, ADR 0019) por baixo.
 */

interface ShareTileProps {
	title: string;
	/** O título da janela ou da tela transmitida, quando se sabe. */
	source?: string;
	action: ReactNode;
	/** A imagem ao vivo (`blob:`), só na própria transmissão. */
	preview?: string;
}

export function ShareTile({ title, source, action, preview }: ShareTileProps) {
	return (
		<div className="relative flex aspect-video w-full flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[10px] border border-border bg-rail px-6 text-center">
			{preview && (
				<img
					src={preview}
					alt=""
					className="absolute inset-0 size-full object-contain opacity-35"
				/>
			)}
			<LiveBadge size="md" className="absolute top-2.5 left-2.5" />
			<MonitorPlayIcon
				aria-hidden="true"
				className="relative size-8 text-muted-foreground"
				strokeWidth={1.75}
			/>
			<span className="relative max-w-full truncate text-sm font-semibold text-foreground">
				{title}
			</span>
			{source && (
				<span className="relative max-w-full truncate text-xs text-muted-foreground">
					{source}
				</span>
			)}
			<div className="relative mt-1.5">{action}</div>
		</div>
	);
}
