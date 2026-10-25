import { ClockIcon, EyeOffIcon, TicketIcon } from "lucide-react";
import type { ReactNode } from "react";
import logo from "@/assets/ashtar.svg";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/*
 * O bilhete dourado do convite recém-criado (quadros "Convites" e "Convite rápido"). O código só
 * aparece aqui, uma vez: a API não mostra de novo. Os botões de copiar vêm de quem usa.
 */

interface InviteTicketProps {
	/** "Convite para uma pessoa", "Convite para o grupo"... */
	title: string;
	/** O endereço sem o código, em letra miúda: `ashtar.exemplo.ts.net/invite/`. */
	url: string;
	code: string;
	/** "Vale até domingo, 20:10". */
	validity: string;
	/** Quantas pessoas cabem, no canhoto. */
	count: number;
	/** "pessoa" ou "pessoas". */
	countLabel: string;
	/** Os botões (Copiar link, Copiar com mensagem). */
	actions?: ReactNode;
	notice?: string;
	className?: string;
}

/** O semicírculo recortado em cima e embaixo do picote. Tem a cor do fundo da tela. */
const notch =
	"absolute -left-3 size-[22px] rounded-full border border-gold-border bg-background";

function InviteTicket({
	title,
	url,
	code,
	validity,
	count,
	countLabel,
	actions,
	notice = "O código aparece só agora.",
	className,
}: InviteTicketProps) {
	return (
		<div
			role="group"
			aria-label="Convite criado"
			className={cn(
				"relative flex overflow-hidden rounded-3xl border border-gold-border bg-card shadow-ticket",
				"bg-linear-115 from-gold-wash via-gold-wash/30 via-46% to-transparent",
				"animate-in fade-in-0 slide-in-from-bottom-2 zoom-in-98 duration-280 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
				className,
			)}
		>
			<span
				aria-hidden="true"
				className="pointer-events-none absolute inset-y-0 -left-40 w-30 bg-linear-90 from-transparent via-gold-text/16 to-transparent animate-ticket-shine"
			/>
			<div className="flex min-w-0 grow flex-col gap-4 px-[26px] py-[22px]">
				<div className="flex items-center justify-between gap-4">
					<span className="flex items-center gap-2 text-[11px] font-bold tracking-[0.08em] text-gold uppercase">
						<TicketIcon className="size-3.5" />
						{title}
					</span>
					<Badge tone="gold" dot>
						Valendo
					</Badge>
				</div>
				<div className="flex flex-col gap-1">
					<span className="font-mono text-[13px] text-gold-muted">{url}</span>
					<span className="font-mono text-[30px] font-medium tracking-[0.06em] text-foreground">
						{code}
					</span>
				</div>
				<span className="flex items-center gap-2 text-[13px] text-muted-foreground">
					<ClockIcon className="size-3.5" />
					{validity}
				</span>
				<div className="flex items-center gap-2.5 pt-0.5">
					{actions}
					<span className="ml-auto flex items-center gap-1.5 text-xs text-foreground-subtle">
						<EyeOffIcon className="size-[13px]" />
						{notice}
					</span>
				</div>
			</div>
			<div
				aria-hidden="true"
				className="relative my-4 w-0 border-l-2 border-dashed border-gold-border"
			>
				<span className={cn(notch, "-top-[29px]")} />
				<span className={cn(notch, "-bottom-[29px]")} />
			</div>
			<div className="flex w-39 shrink-0 flex-col items-center justify-center gap-1.5 bg-gold/7">
				<img src={logo} alt="" className="mb-1.5 size-9 rounded-[9px]" />
				<span className="text-[40px] leading-none font-bold text-gold tabular-nums">
					{count}
				</span>
				<span className="text-[11px] font-bold tracking-[0.08em] text-gold/85 uppercase">
					{countLabel}
				</span>
			</div>
		</div>
	);
}

export { InviteTicket };
