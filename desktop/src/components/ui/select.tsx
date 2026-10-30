import { Select as SelectPrimitive } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * A caixa de escolha do canvas (os dispositivos de Voz e vídeo): 40px, o fundo do trilho, a seta à
 * direita e a lista embaixo, da largura da caixa. Na caixa, um texto longo corta com reticências;
 * na lista, ele quebra a linha. Abre com o clique, com Enter, espaço ou as setas, e o rótulo
 * (`SelectLabel`) já fica ligado à caixa para o leitor de tela. Componente nosso, montado no Base UI.
 */

const Select = SelectPrimitive.Root;

function SelectLabel({ className, ...props }: SelectPrimitive.Label.Props) {
	return (
		<SelectPrimitive.Label
			data-slot="select-label"
			className={cn(
				"text-[13px] leading-none font-semibold text-foreground select-none",
				className,
			)}
			{...props}
		/>
	);
}

function SelectTrigger({
	className,
	children,
	...props
}: SelectPrimitive.Trigger.Props) {
	return (
		<SelectPrimitive.Trigger
			data-slot="select-trigger"
			className={cn(
				"flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-border bg-rail px-3 text-left text-sm text-foreground transition-colors",
				"hover:border-border-strong data-popup-open:border-ring",
				"disabled:cursor-not-allowed disabled:text-foreground-subtle",
				className,
			)}
			{...props}
		>
			{children}
			<SelectPrimitive.Icon className="flex shrink-0 text-muted-foreground">
				<ChevronDownIcon className="size-4" strokeWidth={2.5} />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	);
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
	return (
		<SelectPrimitive.Value
			data-slot="select-value"
			className={cn("min-w-0 flex-1 truncate", className)}
			{...props}
		/>
	);
}

function SelectContent({
	className,
	children,
	...props
}: SelectPrimitive.Popup.Props) {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Positioner
				alignItemWithTrigger={false}
				sideOffset={6}
				className="isolate z-50 outline-none"
			>
				<SelectPrimitive.Popup
					data-slot="select-content"
					className={cn(
						"max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-xl border border-border-strong bg-popover p-1.5 text-popover-foreground shadow-popover outline-none",
						"duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
						className,
					)}
					{...props}
				>
					<SelectPrimitive.List>{children}</SelectPrimitive.List>
				</SelectPrimitive.Popup>
			</SelectPrimitive.Positioner>
		</SelectPrimitive.Portal>
	);
}

function SelectItem({
	className,
	children,
	...props
}: SelectPrimitive.Item.Props) {
	return (
		<SelectPrimitive.Item
			data-slot="select-item"
			className={cn(
				"relative flex min-h-9 cursor-default items-center rounded-md py-2 pr-8 pl-2.5 text-[13px] text-foreground outline-hidden select-none",
				"data-highlighted:bg-accent data-disabled:pointer-events-none data-disabled:text-foreground-subtle",
				className,
			)}
			{...props}
		>
			<SelectPrimitive.ItemText className="min-w-0 flex-1 break-words">
				{children}
			</SelectPrimitive.ItemText>
			<SelectPrimitive.ItemIndicator className="absolute right-2.5 flex text-link">
				<CheckIcon className="size-4" />
			</SelectPrimitive.ItemIndicator>
		</SelectPrimitive.Item>
	);
}

export {
	Select,
	SelectContent,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
};
