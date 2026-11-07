import { ClockIcon, EyeOffIcon, TicketIcon } from "lucide-react";
import type { ReactNode } from "react";
import logo from "@/assets/ashtar.svg";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/*
 * O bilhete dourado do convite recém-criado (quadros "Convites" e "Convite rápido"). O código só
 * aparece aqui, uma vez: a API não mostra de novo. Os botões de copiar vêm de quem usa.
 *
 * Dois tamanhos: o normal, da tela de Convites, e o `compact`, do convite rápido da sala, sem a
 * linha de botões e com a barra do tempo que resta debaixo da validade.
 */

interface InviteTicketProps {
	/** "Convite para uma pessoa", "Para o grupo"... */
	title: string;
	/** O endereço sem o código, em letra miúda: `ashtar.exemplo.ts.net/invite/`. */
	url: string;
	code: string;
	/** "Vale até domingo, 20:10", "Vence às 12:20". */
	validity: string;
	/** Quantas pessoas cabem, no canhoto. */
	count: number;
	/** "pessoa" ou "pessoas". */
	countLabel: string;
	/** Os botões (Copiar link, Copiar com mensagem). Só no tamanho normal. */
	actions?: ReactNode;
	notice?: string;
	/** A pílula do canto; sem ela, "Valendo". */
	status?: ReactNode;
	/** O que resta do prazo, de 0 a 1, para a barra debaixo da validade. Sem ele, sem barra. */
	timeLeft?: number;
	/**
	 * A cor de onde o bilhete está, para os recortes do picote: a página (`background`) ou um
	 * cartão, diálogo ou popover (`card`). Sem ela, a página no tamanho normal e o cartão no compacto.
	 */
	surface?: "background" | "card";
	size?: "default" | "compact";
	className?: string;
}

const SIZES = {
	default: {
		root: "rounded-3xl",
		body: "gap-4 px-[26px] py-[22px]",
		header: "gap-4",
		title: "gap-2 text-[11px] [&_svg]:size-3.5",
		address: "gap-1",
		url: "text-[13px]",
		code: "text-2xl tracking-[0.06em] @xs/ticket:text-[30px]",
		validity: "gap-2 text-[13px] [&_svg]:size-3.5",
		divider: "my-4",
		notch: "-left-3 size-[22px]",
		notchTop: "-top-[29px]",
		notchBottom: "-bottom-[29px]",
		stub: "w-39 gap-1.5",
		logo: "mb-1.5 size-9 rounded-[9px]",
		count: "text-[40px]",
		countLabel: "text-[11px]",
	},
	compact: {
		root: "rounded-xl",
		body: "gap-2.5 px-4 py-3.5",
		header: "gap-2.5",
		title: "gap-1.5 text-[10px] [&_svg]:size-3",
		address: "gap-0.5",
		url: "text-[11px]",
		code: "text-xl tracking-[0.05em]",
		validity: "gap-1.5 text-xs [&_svg]:size-[13px]",
		divider: "my-3",
		notch: "-left-[9px] size-4",
		notchTop: "-top-[21px]",
		notchBottom: "-bottom-[21px]",
		stub: "w-22 gap-1",
		logo: "mb-1 size-[26px] rounded-[7px]",
		count: "text-[28px]",
		countLabel: "text-[10px]",
	},
};

function InviteTicket({
	title,
	url,
	code,
	validity,
	count,
	countLabel,
	actions,
	notice = "O código aparece só agora.",
	status,
	timeLeft,
	surface,
	size = "default",
	className,
}: InviteTicketProps) {
	const s = SIZES[size];
	const compact = size === "compact";
	/** O semicírculo recortado em cima e embaixo do picote. Tem a cor do fundo de onde está. */
	const notch = cn(
		"absolute rounded-full border border-gold-border",
		(surface ?? (compact ? "card" : "background")) === "card"
			? "bg-card"
			: "bg-background",
		s.notch,
	);

	return (
		<div
			role="group"
			aria-label={compact ? `Convite ${title.toLowerCase()}` : "Convite criado"}
			className={cn(
				"relative flex overflow-hidden border border-gold-border bg-card shadow-ticket",
				"bg-linear-115 from-gold-wash via-gold-wash/30 via-46% to-transparent",
				"animate-in fade-in-0 slide-in-from-bottom-2 zoom-in-98 duration-280 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
				s.root,
				className,
			)}
		>
			<span
				aria-hidden="true"
				className="pointer-events-none absolute inset-y-0 -left-40 w-30 bg-linear-90 from-transparent via-gold-text/16 to-transparent animate-ticket-shine"
			/>
			<div
				className={cn("@container/ticket flex min-w-0 grow flex-col", s.body)}
			>
				<div className={cn("flex items-center justify-between", s.header)}>
					<span
						className={cn(
							"flex items-center font-bold tracking-[0.08em] text-gold uppercase",
							s.title,
						)}
					>
						<TicketIcon />
						{title}
					</span>
					{status ?? (
						<Badge
							tone="gold"
							dot
							className={compact ? "px-[7px] py-px text-[11px]" : undefined}
						>
							Valendo
						</Badge>
					)}
				</div>
				<div className={cn("flex flex-col", s.address)}>
					<span className={cn("truncate font-mono text-gold-muted", s.url)}>
						{url}
					</span>
					<span className={cn("font-mono font-medium text-foreground", s.code)}>
						{code}
					</span>
				</div>
				<div className="flex flex-col gap-1.5">
					<span
						className={cn(
							"flex items-center text-muted-foreground",
							s.validity,
						)}
					>
						<ClockIcon />
						{validity}
					</span>
					{timeLeft !== undefined && (
						<span
							aria-hidden="true"
							className="h-[3px] overflow-hidden rounded-xs bg-gold/14"
						>
							<span
								className="block h-full origin-left rounded-xs bg-gold transition-transform duration-1000 ease-linear"
								style={{
									transform: `scaleX(${Math.min(1, Math.max(0, timeLeft))})`,
								}}
							/>
						</span>
					)}
				</div>
				{!compact && (
					<div className="flex flex-wrap items-center gap-2.5 pt-0.5">
						{actions}
						<span className="ml-auto flex items-center gap-1.5 text-xs text-foreground-subtle">
							<EyeOffIcon className="size-[13px]" />
							{notice}
						</span>
					</div>
				)}
			</div>
			<div
				aria-hidden="true"
				className={cn(
					"relative w-0 border-l-2 border-dashed border-gold-border",
					s.divider,
				)}
			>
				<span className={cn(notch, s.notchTop)} />
				<span className={cn(notch, s.notchBottom)} />
			</div>
			<div
				className={cn(
					"flex shrink-0 flex-col items-center justify-center bg-gold/7",
					s.stub,
				)}
			>
				<img src={logo} alt="" className={s.logo} />
				<span
					className={cn(
						"leading-none font-bold text-gold tabular-nums",
						s.count,
					)}
				>
					{count}
				</span>
				<span
					className={cn(
						"font-bold tracking-[0.08em] text-gold/85 uppercase",
						s.countLabel,
					)}
				>
					{countLabel}
				</span>
			</div>
		</div>
	);
}

export { InviteTicket };
