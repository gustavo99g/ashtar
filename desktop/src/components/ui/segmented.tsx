import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Escolha em segmentos ("1 hora | 1 dia | 7 dias", "Valendo | Todos"): o mesmo trilho das abas,
 * mas um grupo de rádio, porque escolhe um valor e não troca de painel. As setas do teclado
 * passam de um para o outro. Componente nosso, montado no Base UI.
 */

interface SegmentedProps {
	value: string;
	onValueChange: (value: string) => void;
	"aria-label": string;
	className?: string;
	children: ReactNode;
}

function Segmented({
	value,
	onValueChange,
	className,
	...props
}: SegmentedProps) {
	return (
		<RadioGroup
			data-slot="segmented"
			value={value}
			onValueChange={(next) => onValueChange(next as string)}
			className={cn(
				"inline-flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-[9px] border border-border bg-rail p-[3px]",
				className,
			)}
			{...props}
		/>
	);
}

function SegmentedItem({
	value,
	className,
	children,
}: {
	value: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<Radio.Root
			data-slot="segmented-item"
			value={value}
			className={cn(
				"inline-flex h-[30px] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors select-none",
				"hover:text-foreground data-checked:bg-selected data-checked:text-selected-foreground",
				className,
			)}
		>
			{children}
		</Radio.Root>
	);
}

export { Segmented, SegmentedItem };
