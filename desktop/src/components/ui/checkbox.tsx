import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * A caixa de marcar do canvas ("Já criar o convite de recuperação"): 18px, azul quando marcada.
 * Use dentro de um `<label>` com o texto, para o clique no texto também marcar.
 */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
	return (
		<CheckboxPrimitive.Root
			data-slot="checkbox"
			className={cn(
				"flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border border-border-strong bg-field transition-colors",
				"data-checked:border-ring data-checked:bg-primary data-checked:text-primary-foreground",
				"data-disabled:cursor-not-allowed data-disabled:opacity-50",
				className,
			)}
			{...props}
		>
			<CheckboxPrimitive.Indicator
				data-slot="checkbox-indicator"
				className="flex"
			>
				<CheckIcon className="size-3" strokeWidth={3} />
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	);
}

export { Checkbox };
