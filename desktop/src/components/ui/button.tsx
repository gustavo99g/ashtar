import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
	[
		"inline-flex shrink-0 items-center justify-center",
		"rounded-md",
		"text-sm font-semibold",
		"whitespace-nowrap select-none",
		"transition-colors",
		"outline-none",
		"focus-visible:outline-none",
		"focus-visible:ring-2 focus-visible:ring-line-focus/30",
		"disabled:pointer-events-none disabled:opacity-50",
		"[&_svg]:pointer-events-none",
		"[&_svg]:shrink-0",
		"[&_svg:not([class*='size-'])]:size-4",
	],
	{
		variants: {
			variant: {
				primary: [
					"bg-accent text-primary",
					"hover:bg-accent-hover",
					"active:bg-accent-active",
				],

				secondary: [
					"bg-raised text-primary",
					"border border-line",
					"hover:bg-hover",
					"active:bg-active",
				],

				ghost: [
					"bg-transparent text-secondary",
					"hover:bg-hover hover:text-primary",
					"active:bg-active active:text-primary",
				],

				outline: [
					"bg-transparent text-primary",
					"border border-line-mid",
					"hover:bg-hover",
					"active:bg-active",
				],

				link: [
					"bg-transparent text-link",
					"hover:text-link-hover",
					"hover:underline hover:underline-offset-4",
				],

				danger: [
					"bg-danger text-primary",
					"hover:bg-danger-hover",
					"active:bg-danger-hover",
				],
			},

			size: {
				default: "h-8 gap-2 px-3",
				xs: "h-6 gap-1 rounded-sm px-2 text-xs",
				sm: "h-7 gap-1.5 px-2.5 text-sm",
				lg: "h-10 gap-2 px-4",
				icon: "size-8",
				"icon-xs": "size-6 rounded-sm",
				"icon-sm": "size-7",
				"icon-lg": "size-10",
			},
		},

		defaultVariants: {
			variant: "primary",
			size: "default",
		},
	},
);

function Button({
	className,
	variant = "primary",
	size = "default",
	...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
	return (
		<ButtonPrimitive
			data-slot="button"
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { Button, buttonVariants };
