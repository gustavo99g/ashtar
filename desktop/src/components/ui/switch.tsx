import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*
 * O interruptor do canvas. Ligado fica dourado por padrão (`gold`: o beta é dourado em todo o app);
 * `blue` usa o azul do tema (`--primary`, o mesmo do botão primário), para o que não é beta.
 * Desligado é igual nos dois.
 */
const switchVariants = cva(
	[
		"group/switch relative inline-flex h-[22px] w-10 shrink-0 items-center rounded-full p-[3px] transition-colors",
		"data-unchecked:bg-border-strong data-disabled:cursor-not-allowed",
	],
	{
		variants: {
			variant: {
				gold: "data-checked:bg-gold data-disabled:data-checked:bg-gold-subtle",
				blue: "data-checked:bg-primary data-disabled:data-checked:bg-info-subtle",
			},
		},
		defaultVariants: { variant: "gold" },
	},
);

const thumbVariants = cva(
	[
		"pointer-events-none flex size-4 items-center justify-center rounded-full transition-transform",
		"data-unchecked:translate-x-0 data-unchecked:bg-primary-foreground data-checked:translate-x-[18px]",
	],
	{
		variants: {
			variant: {
				gold: "data-checked:bg-gold-foreground group-data-disabled/switch:data-checked:bg-gold",
				blue: "data-checked:bg-primary-foreground group-data-disabled/switch:data-checked:bg-primary",
			},
		},
		defaultVariants: { variant: "gold" },
	},
);

function Switch({
	className,
	variant = "gold",
	...props
}: SwitchPrimitive.Root.Props & VariantProps<typeof switchVariants>) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			className={cn(switchVariants({ variant }), className)}
			{...props}
		>
			<SwitchPrimitive.Thumb
				data-slot="switch-thumb"
				className={thumbVariants({ variant })}
			/>
		</SwitchPrimitive.Root>
	);
}

export { Switch };
