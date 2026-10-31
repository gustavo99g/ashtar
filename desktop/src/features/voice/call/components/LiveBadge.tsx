import { cn } from "@/lib/utils";

/** O selo dourado TRANSMITINDO, com a bolinha piscando (parada com "reduzir movimento"). */
export function LiveBadge({
	size = "sm",
	className,
}: {
	size?: "sm" | "md";
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center gap-1 rounded-sm bg-live font-bold text-live-foreground",
				size === "sm"
					? "px-[5px] py-px text-[9px] tracking-[0.04em]"
					: "px-1.5 py-0.5 text-[10px] tracking-[0.05em]",
				className,
			)}
		>
			<span
				aria-hidden="true"
				className="size-[5px] animate-pulse rounded-full bg-current motion-reduce:animate-none"
			/>
			TRANSMITINDO
		</span>
	);
}
