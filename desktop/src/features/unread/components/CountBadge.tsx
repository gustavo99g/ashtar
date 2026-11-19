import { cn } from "@/lib/utils";

/**
 * O número de não lidas, em dourado: ao lado do nome da aba Conversas, no canto do ícone da faixa,
 * em cada conversa da lista e nas abas das conversas abertas. Com zero não desenha nada; de 100 para cima mostra "99+" (a API para de contar em 100).
 */
export function CountBadge({
	count,
	label,
	className,
}: {
	count: number;
	/** O que o leitor de tela diz. Sem isto, "N não lidas". */
	label?: string;
	className?: string;
}) {
	if (count <= 0) return null;
	return (
		<span
			aria-label={
				label ?? (count === 1 ? "1 não lida" : `${count > 99 ? "99+" : count} não lidas`)
			}
			className={cn(
				"min-w-[18px] rounded-[9px] bg-gold px-[5px] py-px text-center text-[11px] font-bold text-gold-foreground",
				className,
			)}
		>
			{count > 99 ? "99+" : count}
		</span>
	);
}
