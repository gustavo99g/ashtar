import {
	GalleryThumbnailsIcon,
	LayoutGridIcon,
	Volume2Icon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SALA } from "../channel";

/*
 * O topo da sala: o nome, um resumo (quantas pessoas, ou quem está sendo assistido) e, à direita,
 * o Convidar e a troca entre Grade e Foco.
 */

interface RoomHeaderProps {
	subtitle?: string;
	/** O que fica à direita (Convidar e a troca de layout). */
	actions?: ReactNode;
}

export function RoomHeader({ subtitle, actions }: RoomHeaderProps) {
	return (
		<header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
			<Volume2Icon aria-hidden="true" className="size-5 text-ring" />
			<h1 className="text-[15px] font-bold text-foreground">{SALA.name}</h1>
			{subtitle && (
				<>
					<span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
					<span className="truncate text-[13px] text-muted-foreground">
						{subtitle}
					</span>
				</>
			)}
			<div className="ml-auto flex items-center gap-2">{actions}</div>
		</header>
	);
}

interface LayoutToggleProps {
	focus: boolean;
	/** Sem transmissão, o Foco não tem o que mostrar. */
	focusAvailable: boolean;
	onGrid: () => void;
	onFocus: () => void;
}

export function LayoutToggle({
	focus,
	focusAvailable,
	onGrid,
	onFocus,
}: LayoutToggleProps) {
	return (
		<div
			role="group"
			aria-label="Layout"
			className="flex rounded-lg border border-border bg-card p-0.5"
		>
			<LayoutButton pressed={!focus} onClick={onGrid}>
				<LayoutGridIcon />
				Grade
			</LayoutButton>
			<LayoutButton
				pressed={focus}
				disabled={!focusAvailable}
				title={focusAvailable ? undefined : "Ninguém está transmitindo"}
				onClick={onFocus}
			>
				<GalleryThumbnailsIcon />
				Foco
			</LayoutButton>
		</div>
	);
}

function LayoutButton({
	pressed,
	disabled,
	title,
	onClick,
	children,
}: {
	pressed: boolean;
	disabled?: boolean;
	title?: string;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-pressed={pressed}
			disabled={disabled}
			title={title}
			onClick={onClick}
			className={cn(
				"flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium [&_svg]:size-3.5",
				pressed
					? "bg-secondary text-foreground"
					: "text-muted-foreground hover:bg-secondary hover:text-foreground",
				"disabled:pointer-events-none disabled:text-foreground-faint",
			)}
		>
			{children}
		</button>
	);
}
