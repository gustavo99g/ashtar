import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Chips de filtro ("Todos 8", "Beta 2"...). Um grupo de rádio: sempre um escolhido, e as setas
 * do teclado passam de um para o outro. Componente nosso, montado no Base UI (o shadcn não tem).
 */

interface ChipGroupProps {
	value: string;
	onValueChange: (value: string) => void;
	"aria-label": string;
	className?: string;
	children: ReactNode;
}

function ChipGroup({
	value,
	onValueChange,
	className,
	...props
}: ChipGroupProps) {
	return (
		<RadioGroup
			data-slot="chip-group"
			value={value}
			onValueChange={(next) => onValueChange(next as string)}
			className={cn("flex flex-wrap gap-2", className)}
			{...props}
		/>
	);
}

const chipVariants = cva(
	[
		"group/chip inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border border-border-strong px-3 text-[13px] font-medium text-muted-foreground transition-colors select-none",
		"hover:border-ring hover:text-foreground",
	],
	{
		variants: {
			tone: {
				default:
					"data-checked:border-ring data-checked:bg-selected data-checked:text-foreground",
				gold: "data-checked:border-gold data-checked:bg-gold-subtle data-checked:text-gold-text",
			},
		},
		defaultVariants: { tone: "default" },
	},
);

const countVariants = cva(
	"min-w-[18px] rounded-full px-[5px] text-center text-[11px] leading-[18px] font-bold tabular-nums",
	{
		variants: {
			tone: {
				default: "bg-secondary group-data-checked/chip:bg-foreground/15",
				gold: "bg-gold-subtle text-gold group-data-checked/chip:bg-gold/20",
			},
		},
		defaultVariants: { tone: "default" },
	},
);

interface ChipProps extends VariantProps<typeof chipVariants> {
	value: string;
	/** O número ao lado do nome. */
	count?: number;
	className?: string;
	children: ReactNode;
}

function Chip({ value, count, tone, className, children }: ChipProps) {
	return (
		<Radio.Root
			data-slot="chip"
			value={value}
			className={cn(chipVariants({ tone }), className)}
		>
			{children}
			{count !== undefined && (
				<span className={countVariants({ tone })}>{count}</span>
			)}
		</Radio.Root>
	);
}

export { Chip, ChipGroup };
