import { cn } from "@/lib/utils";

/**
 * O número de não lidas, em dourado: ao lado do nome da aba e no canto do ícone da faixa. Com
 * zero não desenha nada; de 100 para cima mostra "99+" (a API para de contar em 100).
 */
export function CountBadge({
	count,
	className,
}: {
	count: number;
	className?: string;
}) {
	if (count <= 0) return null;
	return (
		<span
			className={cn(
				"min-w-[18px] rounded-[9px] bg-gold px-[5px] py-px text-center text-[11px] font-bold text-gold-foreground",
				className,
			)}
		>
			{count > 99 ? "99+" : count}
		</span>
	);
}
