import { Input as InputPrimitive } from "@base-ui/react/input";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: ComponentProps<"input">) {
	return (
		<InputPrimitive
			type={type}
			data-slot="input"
			className={cn(
				"h-11 w-full min-w-0 rounded-lg border border-input bg-field px-3.5 text-[15px] text-foreground transition-[border-color,box-shadow]",
				"placeholder:text-foreground-subtle",
				"focus:border-ring focus:ring-3 focus:ring-ring/25",
				"aria-invalid:border-destructive-border aria-invalid:ring-3 aria-invalid:ring-destructive-border/20",
				"disabled:cursor-not-allowed disabled:text-foreground-subtle",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
