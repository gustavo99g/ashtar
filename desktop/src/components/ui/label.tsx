import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

function Label({ className, ...props }: ComponentProps<"label">) {
	return (
		<label
			data-slot="label"
			className={cn(
				"flex items-center gap-2 text-[13px] leading-none font-semibold text-foreground select-none",
				className,
			)}
			{...props}
		/>
	);
}

export { Label };
