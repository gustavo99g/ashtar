import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*
 * Os botões do canvas. O contorno dourado do foco vem do App.css, igual para tudo que recebe
 * foco, por isso não tem `focus-visible:` aqui.
 */
const buttonVariants = cva(
	[
		"inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-transparent",
		"font-semibold whitespace-nowrap select-none transition-colors",
		"disabled:pointer-events-none aria-disabled:cursor-not-allowed",
		"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	],
	{
		variants: {
			variant: {
				primary:
					"bg-primary text-primary-foreground hover:bg-primary-hover disabled:bg-secondary disabled:text-foreground-subtle",
				secondary:
					"bg-secondary text-secondary-foreground hover:bg-secondary-hover hover:text-foreground disabled:text-foreground-subtle",
				outline:
					"border-border-strong text-secondary-foreground hover:border-ring hover:bg-secondary hover:text-foreground disabled:border-border disabled:text-foreground-subtle",
				ghost:
					"text-secondary-foreground hover:bg-secondary hover:text-foreground disabled:text-foreground-subtle",
				danger:
					"bg-destructive text-destructive-foreground hover:bg-destructive-hover disabled:bg-secondary disabled:text-foreground-subtle",
				warning:
					"bg-warning text-warning-foreground hover:bg-warning-hover disabled:bg-secondary disabled:text-foreground-subtle",
				link: "text-link hover:text-link-hover disabled:text-foreground-subtle",
			},
			size: {
				sm: "h-8 px-3 text-xs",
				default: "h-9 px-4 text-[13px]",
				lg: "h-11 px-5 text-sm",
				"icon-sm": "size-8",
				icon: "size-9",
			},
		},
		compoundVariants: [{ variant: "link", class: "h-auto px-0" }],
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
