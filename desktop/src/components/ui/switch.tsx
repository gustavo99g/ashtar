import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/lib/utils";

/** O interruptor do canvas: ligado fica dourado (o beta é dourado em todo o app). */
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			className={cn(
				"group/switch relative inline-flex h-[22px] w-10 shrink-0 items-center rounded-full p-[3px] transition-colors",
				"data-unchecked:bg-border-strong data-checked:bg-gold",
				"data-disabled:cursor-not-allowed data-disabled:data-checked:bg-gold-subtle",
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb
				data-slot="switch-thumb"
				className={cn(
					"pointer-events-none flex size-4 items-center justify-center rounded-full transition-transform",
					"data-unchecked:translate-x-0 data-unchecked:bg-primary-foreground",
					"data-checked:translate-x-[18px] data-checked:bg-gold-foreground",
					"group-data-disabled/switch:data-checked:bg-gold",
				)}
			/>
		</SwitchPrimitive.Root>
	);
}

export { Switch };
