import type { ReactNode } from "react";
import logo from "@/assets/ashtar.svg";
import { cn } from "@/lib/utils";
import { EntrySky } from "./EntrySky";

/*
 * As peças que toda tela da entrada usa: o fundo com o céu e o cartão de 440px no meio, o topo
 * com o ícone, o título e o texto, a linha "ou cole aqui" e a nota do rodapé do cartão.
 */

/**
 * O fundo da entrada com o cartão no meio. Numa janela baixa (o mínimo é 1000 × 640), o cartão
 * rola em vez de ser cortado: o `m-auto` centraliza enquanto cabe.
 */
export function EntryScreen({
	labelledBy,
	children,
}: {
	labelledBy: string;
	children: ReactNode;
}) {
	return (
		<div className="relative h-full overflow-hidden bg-background bg-radial-[ellipse_60%_55%_at_50%_45%] from-primary/13 to-transparent to-70%">
			<EntrySky />
			<main className="relative flex h-full overflow-y-auto p-6">
				<div
					role="region"
					aria-labelledby={labelledBy}
					className="m-auto flex w-[440px] max-w-full flex-col gap-6 rounded-3xl border border-border bg-card px-8 pt-9 pb-7 shadow-dialog"
				>
					{children}
				</div>
			</main>
		</div>
	);
}

interface EntryHeaderProps {
	/** O `id` do título, que o `EntryScreen` usa no `aria-labelledby`. */
	titleId: string;
	title: ReactNode;
	description?: ReactNode;
	/** No lugar do ícone do Ashtar (a tela "saiu do grupo" tem o seu). */
	media?: ReactNode;
}

/** O topo do cartão: o ícone do Ashtar (ou outro), o título e o texto, centralizados. */
export function EntryHeader({
	titleId,
	title,
	description,
	media,
}: EntryHeaderProps) {
	return (
		<div className="flex flex-col items-center gap-3.5 text-center">
			{media ?? <img src={logo} alt="" className="size-16 rounded-[16px]" />}
			<div className="flex flex-col gap-1.5">
				<h1
					id={titleId}
					className="text-[22px] leading-[1.3] font-bold text-balance text-foreground"
				>
					{title}
				</h1>
				{description && (
					<p className="text-sm leading-[1.55] text-balance text-muted-foreground">
						{description}
					</p>
				)}
			</div>
		</div>
	);
}

/** A linha "ou cole aqui", entre o texto e o campo. */
export function OrPasteDivider() {
	return (
		<div
			aria-hidden="true"
			className="flex items-center gap-3 text-xs text-muted-foreground"
		>
			<span className="h-px grow bg-border" />
			ou cole aqui
			<span className="h-px grow bg-border" />
		</div>
	);
}

/** A nota no pé do cartão, separada por uma linha. */
export function EntryFootnote({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"border-t border-border pt-5 text-xs leading-normal text-muted-foreground",
				className,
			)}
		>
			{children}
		</div>
	);
}
