import { cn } from "@/lib/utils";
import { labelKeys } from "../model/shortcuts";

/** As teclas de um atalho, uma por caixinha, com o "+" entre elas. */
export function ShortcutKeys({
	label,
	className,
}: {
	label: string;
	className?: string;
}) {
	const keys = labelKeys(label);
	return (
		<span
			aria-label={label}
			className={cn("flex items-center gap-1", className)}
		>
			{keys.map((key, index) => (
				<span key={`${index}-${key}`} aria-hidden="true" className="contents">
					{index > 0 && (
						<span className="text-[11px] text-foreground-subtle">+</span>
					)}
					<kbd className="rounded-[5px] border border-border-strong bg-secondary px-2 py-[3px] font-mono text-xs text-foreground">
						{key}
					</kbd>
				</span>
			))}
		</span>
	);
}
