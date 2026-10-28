import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Os botões da chamada: o redondo com rótulo da barra de baixo da sala e o baixo do painel "Voz
 * conectada". Repassam ref e props, para servirem de gatilho de um popover.
 */

interface BarButtonProps extends Omit<ComponentProps<"button">, "children"> {
	label: string;
	tone?: "default" | "off" | "on" | "exit";
	children: ReactNode;
}

const circleTones = {
	default: "bg-secondary text-foreground group-hover:bg-secondary-hover",
	off: "bg-destructive-subtle text-destructive-border",
	on: "bg-primary text-primary-foreground group-hover:bg-primary-hover",
	exit: "bg-destructive text-destructive-foreground group-hover:bg-destructive-hover",
};

export function BarButton({
	label,
	tone = "default",
	className,
	children,
	...props
}: BarButtonProps) {
	return (
		<button
			type="button"
			className={cn(
				"group flex w-[76px] flex-col items-center gap-1 disabled:cursor-not-allowed disabled:opacity-50",
				"aria-disabled:[&>span:first-child]:text-foreground-subtle",
				className,
			)}
			{...props}
		>
			<span
				className={cn(
					"flex size-10 items-center justify-center rounded-full transition-colors [&_svg]:size-5",
					circleTones[tone],
				)}
			>
				{children}
			</span>
			<span
				className={cn(
					"text-xs",
					tone === "exit" ? "text-destructive-text" : "text-muted-foreground",
				)}
			>
				{label}
			</span>
		</button>
	);
}

export function DockButton({ className, ...props }: ComponentProps<"button">) {
	return (
		<button
			type="button"
			className={cn(
				"flex h-8 items-center justify-center gap-1.5 rounded-lg bg-secondary-hover text-xs font-semibold text-secondary-foreground hover:bg-accent [&_svg]:size-4 [&_svg]:stroke-[1.75]",
				"aria-disabled:text-foreground-subtle disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}
