import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/*
 * O esqueleto dos estados (vazio, erro, sem conexão...): ícone, título, texto e ação, no meio.
 * Os estados prontos ficam em `states.tsx`.
 */

function Empty({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			data-slot="empty"
			className={cn(
				"flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-3 px-5 py-9 text-center text-balance",
				className,
			)}
			{...props}
		/>
	);
}

function EmptyHeader({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			data-slot="empty-header"
			className={cn("flex max-w-sm flex-col items-center gap-2.5", className)}
			{...props}
		/>
	);
}

const emptyMediaVariants = cva(
	"flex size-11 shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
	{
		variants: {
			tone: {
				neutral: "rounded-2xl bg-secondary text-foreground-subtle",
				info: "rounded-full bg-info-subtle text-info-text",
				warning: "rounded-full bg-warning-subtle text-status-connecting",
				danger: "rounded-full bg-destructive-border/12 text-destructive-text",
				gold: "rounded-full bg-gold-subtle text-gold",
			},
		},
		defaultVariants: { tone: "neutral" },
	},
);

function EmptyMedia({
	className,
	tone,
	...props
}: ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
	return (
		<div
			data-slot="empty-media"
			aria-hidden="true"
			className={cn(emptyMediaVariants({ tone }), className)}
			{...props}
		/>
	);
}

function EmptyTitle({ className, ...props }: ComponentProps<"p">) {
	return (
		<p
			data-slot="empty-title"
			className={cn(
				"text-[15px] leading-snug font-semibold text-foreground",
				className,
			)}
			{...props}
		/>
	);
}

function EmptyDescription({ className, ...props }: ComponentProps<"p">) {
	return (
		<p
			data-slot="empty-description"
			className={cn(
				"text-[13px] leading-normal text-muted-foreground",
				className,
			)}
			{...props}
		/>
	);
}

function EmptyContent({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			data-slot="empty-content"
			className={cn(
				"flex w-full max-w-sm flex-col items-center gap-3",
				className,
			)}
			{...props}
		/>
	);
}

export {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
};
