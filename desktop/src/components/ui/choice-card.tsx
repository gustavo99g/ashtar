import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Cartões de escolha (os modelos de convite): um grupo de rádio em que cada opção é um cartão com
 * ícone, título e resumo, e o escolhido ganha a borda azul e a marca no canto. Componente nosso,
 * montado no Base UI.
 */

interface ChoiceCardGroupProps {
	value: string;
	onValueChange: (value: string) => void;
	"aria-label": string;
	className?: string;
	children: ReactNode;
}

function ChoiceCardGroup({
	value,
	onValueChange,
	className,
	...props
}: ChoiceCardGroupProps) {
	return (
		<RadioGroup
			data-slot="choice-card-group"
			value={value}
			onValueChange={(next) => onValueChange(next as string)}
			className={cn("grid gap-3", className)}
			{...props}
		/>
	);
}

interface ChoiceCardProps {
	value: string;
	icon: ReactNode;
	title: ReactNode;
	description: ReactNode;
	className?: string;
}

function ChoiceCard({
	value,
	icon,
	title,
	description,
	className,
}: ChoiceCardProps) {
	return (
		<Radio.Root
			data-slot="choice-card"
			value={value}
			className={cn(
				"group/choice relative flex min-w-0 cursor-pointer items-center gap-3 rounded-[10px] border border-border bg-background px-4 py-3.5 text-left transition-colors select-none",
				"hover:border-ring data-checked:border-ring data-checked:bg-selected/40",
				className,
			)}
		>
			<span className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px] bg-secondary text-muted-foreground group-data-checked/choice:bg-primary group-data-checked/choice:text-primary-foreground [&>svg]:size-[18px]">
				{icon}
			</span>
			<span className="flex min-w-0 flex-col gap-[3px] pr-5">
				<span className="truncate text-sm font-semibold text-foreground">
					{title}
				</span>
				<span className="truncate text-xs text-muted-foreground">
					{description}
				</span>
			</span>
			<Radio.Indicator className="absolute top-2.5 right-2.5 flex size-[18px] items-center justify-center rounded-full bg-ring text-primary-foreground">
				<CheckIcon className="size-[11px]" strokeWidth={3} />
			</Radio.Indicator>
		</Radio.Root>
	);
}

export { ChoiceCard, ChoiceCardGroup };
