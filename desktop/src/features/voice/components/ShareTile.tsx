import { MonitorPlayIcon } from "lucide-react";
import type { ReactNode } from "react";
import { LiveBadge } from "./LiveBadge";

/*
 * O lugar de uma transmissão na Grade: quem está transmitindo, o que é (o título da janela ou da
 * tela) e o botão para assistir. A imagem só aparece no Foco.
 */

interface ShareTileProps {
	title: string;
	/** O título da janela ou da tela transmitida, quando se sabe. */
	source?: string;
	action: ReactNode;
}

export function ShareTile({ title, source, action }: ShareTileProps) {
	return (
		<div className="relative flex aspect-video w-full flex-col items-center justify-center gap-1.5 rounded-[10px] border border-border bg-rail px-6 text-center">
			<LiveBadge size="md" className="absolute top-2.5 left-2.5" />
			<MonitorPlayIcon
				aria-hidden="true"
				className="size-8 text-muted-foreground"
				strokeWidth={1.75}
			/>
			<span className="max-w-full truncate text-sm font-semibold text-foreground">
				{title}
			</span>
			{source && (
				<span className="max-w-full truncate text-xs text-muted-foreground">
					{source}
				</span>
			)}
			<div className="mt-1.5">{action}</div>
		</div>
	);
}
