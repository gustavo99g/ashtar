import { Avatar, nickColor } from "@/features/identity";
import { cn } from "@/lib/utils";

/*
 * O cartão que abre ao clicar num nome: o nome visível em cima e o nick embaixo, porque nomes
 * podem se repetir e o nick não. A faixa do topo sai da cor do nick.
 */

interface PersonCardProps {
	nick: string;
	name: string;
	sharing: boolean;
	channelName: string;
}

export function PersonCard({
	nick,
	name,
	sharing,
	channelName,
}: PersonCardProps) {
	return (
		<div className="flex flex-col">
			<div
				aria-hidden="true"
				className="h-14"
				style={{
					backgroundImage: `linear-gradient(135deg, ${nickColor(nick)}, var(--color-selected))`,
				}}
			/>
			<div className="flex flex-col gap-3 px-4 pb-4">
				<Avatar
					nick={nick}
					displayName={name}
					size={60}
					className="-mt-[34px] border-4 border-card"
				/>
				<div className="flex flex-col gap-0.5">
					<span className="text-lg font-bold text-foreground">{name}</span>
					<span className="text-[13px] text-muted-foreground">{nick}</span>
				</div>
				<span aria-hidden="true" className="h-px bg-border" />
				<span
					className={cn(
						"flex items-center gap-1.5 text-[13px]",
						sharing ? "text-gold-text" : "text-secondary-foreground",
					)}
				>
					<span
						aria-hidden="true"
						className={cn(
							"size-2 rounded-full",
							sharing ? "bg-live" : "bg-status-online",
						)}
					/>
					{sharing ? `Transmitindo na ${channelName}` : `Na ${channelName}`}
				</span>
			</div>
		</div>
	);
}
