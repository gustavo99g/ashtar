import type { Status } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * A bolinha de status no canto do avatar: verde (Disponível), a lua amarela (Ausente, ADR 0027),
 * vermelha com um traço (Ocupado) ou um anel cinza (Invisível, que só a própria pessoa vê em si).
 * Quem está offline não tem bolinha.
 *
 * A borda tem a cor do fundo em volta, para a bolinha "recortar" o avatar: troque o `border-card`
 * pela do lugar (no painel, `border-secondary`).
 */
export function StatusDot({
	status,
	className,
}: {
	status: Status;
	/** O tamanho, a posição e a cor da borda. */
	className?: string;
}) {
	return (
		<span
			data-status={status}
			className={cn(
				"absolute -right-0.5 -bottom-0.5 box-border flex size-3 items-center justify-center rounded-full border-2 border-card",
				status === "available" && "bg-status-online",
				status === "away" && "overflow-hidden bg-status-away",
				status === "busy" && "bg-status-busy",
				status === "invisible" && "bg-card",
				className,
			)}
		>
			{status === "away" && (
				// A lua: um círculo da cor do fundo por cima, deslocado para o canto.
				<span className="absolute -top-[2px] -left-[2px] size-[70%] rounded-full bg-card" />
			)}
			{status === "busy" && (
				<span className="h-[2px] w-1/2 min-w-1 rounded-[1px] bg-card" />
			)}
			{status === "invisible" && (
				<span className="size-full rounded-full border-[2.5px] border-status-offline" />
			)}
		</span>
	);
}
