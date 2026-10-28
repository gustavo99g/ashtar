import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*
 * A pílula do canvas ("Valendo", "Usado", "Revogado"...): fundo escuro do tom, texto claro e,
 * com `dot`, a bolinha de 6px na cor do texto (`bg-current`).
 */
const badgeVariants = cva(
	"inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
	{
		variants: {
			tone: {
				neutral: "bg-neutral-subtle text-muted-foreground",
				info: "bg-info-subtle text-info-text",
				success: "bg-success-subtle text-success-text",
				warning: "bg-warning-subtle text-warning-text",
				danger: "bg-destructive-subtle text-destructive-text",
				gold: "bg-gold-subtle text-gold",
				violet: "bg-violet-subtle text-violet-text",
			},
		},
		defaultVariants: { tone: "neutral" },
	},
);

function Badge({
	className,
	tone = "neutral",
	dot = false,
	render,
	children,
	...props
}: useRender.ComponentProps<"span"> &
	VariantProps<typeof badgeVariants> & { dot?: boolean }) {
	return useRender({
		defaultTagName: "span",
		props: mergeProps<"span">(
			{
				className: cn(badgeVariants({ tone }), className),
				children: (
					<>
						{dot && (
							<span
								aria-hidden="true"
								className="size-1.5 rounded-full bg-current"
							/>
						)}
						{children}
					</>
				),
			},
			props,
		),
		render,
		state: { slot: "badge", tone },
	});
}

export { Badge, badgeVariants };
