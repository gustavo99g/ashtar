import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const tones = {
	info: "bg-info-subtle text-link-hover",
	warning: "bg-warning-subtle text-status-connecting",
	gold: "bg-gold-subtle text-gold",
};

/** O círculo com o ícone à esquerda de um aviso do compartilhamento. */
export function NoticeIcon({
	tone,
	children,
}: {
	tone: keyof typeof tones;
	children: ReactNode;
}) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"flex size-9 shrink-0 items-center justify-center rounded-full [&_svg]:size-[18px]",
				tones[tone],
			)}
		>
			{children}
		</span>
	);
}
